import { apiInitializer } from "discourse/lib/api";
import { schedule } from "@ember/runloop";
import { ajax } from "discourse/lib/ajax";

export default apiInitializer("1.8.0", (api) => {
  console.log(" AUTO-OPEN COMPOSER LOADED - VERSION 3.0.0 (SIMPLE MODE) ");
  
  if (!settings.enable_url_composer_templates || !settings.enable_auto_open_composer) {
    console.log(" Auto-open disabled via settings");
    return;
  }

  const log = (...args) => {
    if (settings.debug_mode) {
      console.log(" [Auto-Open Composer]", ...args);
    }
  };

  log("Initializing auto-open logic");

  const STORAGE_KEY_AUTO_OPEN_CHECKED = "url_composer_auto_open_checked";
  const STORAGE_KEY_TEMPLATE_ID = "url_composer_template_id";
  const STORAGE_KEY_APPLIED = "url_composer_template_applied";
  
  // Draft resurrection watcher - prevents Discourse from resurrecting deleted drafts
  let draftWatchInterval = null;
  
  const startDraftWatcher = (composer) => {
    if (draftWatchInterval) {
      clearInterval(draftWatchInterval);
    }
    
    log("Starting draft resurrection watcher");
    
    draftWatchInterval = setInterval(() => {
      const model = composer.get("model");
      
      // If composer closed or draft manually saved, stop watching
      if (!model || !model.draftKey) {
        log("Draft cleared or composer closed, stopping watcher");
        clearInterval(draftWatchInterval);
        draftWatchInterval = null;
        return;
      }
      
      // Check if template was applied
      const templateApplied = sessionStorage.getItem(STORAGE_KEY_APPLIED);
      if (!templateApplied) {
        return;
      }
      
      // If draft is trying to resurrect, kill it
      const draftKey = model.draftKey;
      if (draftKey && draftKey !== "new_topic") {
        log("Draft resurrection detected, clearing draftKey:", draftKey);
        model.set("draftKey", "new_topic");
      }
    }, 50); // Check every 50ms
  };

  // Get template settings by ID
  const getTemplateSettings = (templateId) => {
    for (let i = 1; i <= 6; i++) {
      const id = settings[`template_${i}_id`];
      const enabled = settings[`template_${i}_enabled`];
      
      if (enabled && id === templateId) {
        return {
          enabled: true,
          id: settings[`template_${i}_id`],
          urlMatch: settings[`template_${i}_url_match`],
          mode: settings[`template_${i}_mode`] || "ifNoTopics",
          useFor: settings[`template_${i}_use_for`] || "both",
          title: settings[`template_${i}_title`],
          text: settings[`template_${i}_text`]
        };
      }
    }
    return null;
  };

  // Extract tags from current URL
  const getTagsFromUrl = () => {
    const path = window.location.pathname;

    // Match tag intersection routes: /tags/intersection/tag1/tag2
    const tagIntersectionMatch = path.match(/\/tags\/intersection\/(.+)/);
    if (tagIntersectionMatch) {
      return tagIntersectionMatch[1].split("/").map(decodeURIComponent);
    }

    // Match single tag routes: /tag/tagname
    const singleTagMatch = path.match(/\/tag\/([^/]+)/);
    if (singleTagMatch) {
      return [decodeURIComponent(singleTagMatch[1])];
    }

    // Match tags query parameter
    const params = new URLSearchParams(window.location.search);
    const tagsParam = params.get("tags");
    if (tagsParam) {
      return tagsParam.split(",").map((t) => t.trim());
    }

    return [];
  };

  // Auto-open composer if conditions are met
  const autoOpenComposerIfNeeded = () => {
    const params = new URLSearchParams(window.location.search);
    
    // First check sessionStorage (set by url-composer-templates.js or postMessage)
    let templateId = sessionStorage.getItem(STORAGE_KEY_TEMPLATE_ID);
    
    // Fall back to URL parameter if not in sessionStorage
    if (!templateId) {
      templateId = params.get(settings.template_param_key);
    }
    
    // Get hasTopics from sessionStorage (set by postMessage from fl-maps iframe)
    const hasTopics = sessionStorage.getItem('url_composer_has_topics') === 'true';
    
    // Check if we've already checked this page load to prevent loops
    // But we want to allow re-checks on navigation, so we use a session key that we clear on page change
    const alreadyChecked = sessionStorage.getItem(STORAGE_KEY_AUTO_OPEN_CHECKED);
    if (alreadyChecked) {
      return;
    }
    sessionStorage.setItem(STORAGE_KEY_AUTO_OPEN_CHECKED, "true");

    if (!templateId) {
      return;
    }
    
    // Check if composer is already open - if so, don't try to open it again
    const composer = api.container?.lookup?.("controller:composer");
    if (composer && composer.get("model")) {
      log("Composer already open, skipping auto-open");
      return;
    }

    log("Checking template:", templateId, "has_topics:", hasTopics);

    // Get template settings
    const template = getTemplateSettings(templateId);
    if (!template) {
      log("Template not found or not enabled:", templateId);
      return;
    }

    // Check if URL matches (if url_match is configured)
    if (template.urlMatch) {
      const currentUrl = window.location.pathname + window.location.search;
      // If template came from postMessage (sessionStorage), we might skip URL check?
      // But for now, let's trust the logic.
      // If the template ID matches what's in the URL/Path, we are good.
      // If it came from postMessage, it might not match the current URL's "urlMatch" rule if we are on a generic page.
      // But usually the trigger is on the page that matches.
    }

    // Check mode to determine if we should open
    let shouldOpen = false;
    
    if (template.mode === "always") {
      shouldOpen = true;
      log("Mode is 'always', will open composer");
    } else if (template.mode === "ifNoTopics") {
      // If has_topics is true, it means topics exist, so we do NOT open.
      // If has_topics is false or missing, we assume no topics exist, so we OPEN.
      if (hasTopics) {
        shouldOpen = false;
        log("Mode is 'ifNoTopics' and has_topics=true. Topics exist. NOT opening.");
      } else {
        shouldOpen = true;
        log("Mode is 'ifNoTopics' and has_topics!=true. No topics (or unknown). Opening.");
      }
    } else if (template.mode === "ifUserHasNoTopic") {
      // Check if the current user has already posted to these tags via Discourse API
      const tags = getTagsFromUrl();
      const currentUser = api.getCurrentUser();
      
      if (!currentUser || tags.length === 0) {
        shouldOpen = true;
        log("Mode is 'ifUserHasNoTopic' but no user/tags found. Opening by default.");
      } else {
        // Need to make async API call - this will be handled below
        shouldOpen = "checkApi";
        log("Mode is 'ifUserHasNoTopic', will check API for user posts with tags:", tags);
      }
    }

    // Handle API check for ifUserHasNoTopic mode
    if (shouldOpen === "checkApi") {
      const tags = getTagsFromUrl();
      const currentUser = api.getCurrentUser();
      
      log("Checking if user has posted to tags:", tags);
      
      // Search for topics with these tags - Discourse search will only return topics visible to current user
      const tagsKey = tags.join("+");
      // Use advanced search syntax
      const searchQuery = `tags:${tagsKey} @${currentUser.username} order:latest`;
      
      log("🔍 Search query:", searchQuery);
      
      ajax('/search.json', {
        data: { 
          q: searchQuery,
          type: "topic",
          page: 1
        }
      }).then((results) => {
        log("Search results:", results);
        
        // Check if any topics were created by the current user
        // We check if the user is the first poster (Original Poster)
        const hasPosted = results.topics && results.topics.some(topic => {
          // Check if user is in posters list with "Original Poster" description
          const isOP = topic.posters && topic.posters.some(poster => 
            poster.user_id === currentUser.id && 
            (poster.description.includes('Original Poster') || poster.description.includes('Original'))
          );
          
          // Fallback: check if user is the first poster in the list (usually OP)
          const isFirstPoster = topic.posters && topic.posters.length > 0 && topic.posters[0].user_id === currentUser.id;

          // Fallback 2: Check if the topic author_id matches current user (if available in search results)
          // Note: search results might not have author_id directly on the topic object, but let's check
          const isAuthorId = topic.author_id === currentUser.id;

          log(`Topic "${topic.title}" - isOP: ${isOP}, isFirstPoster: ${isFirstPoster}, isAuthorId: ${isAuthorId}`);
          return isOP || isFirstPoster || isAuthorId;
        });
        
        if (hasPosted) {
          log("User has already posted to these tags. NOT opening composer.");
        } else {
          log("User has NOT posted to these tags. Opening composer.");
          openComposerNow(template, params);
        }
      }).catch((error) => {
        log("API check failed, opening composer by default:", error);
        openComposerNow(template, params);
      });
    } else if (shouldOpen) {
      openComposerNow(template, params);
    }
  };
  
  // Helper function to open composer (extracted to avoid duplication)
  const openComposerNow = (template, params) => {
    log("Opening composer for template:", template);

    schedule("afterRender", () => {
      // Poll for composer and site readiness
      const waitForReady = (callback, maxAttempts = 20) => {
        let attempts = 0;
        const check = () => {
          const composer = api.container.lookup("controller:composer");
          const site = api.container.lookup("service:site");
          const currentUser = api.getCurrentUser();
          
          if (composer && site && site.categories && currentUser) {
            callback();
          } else if (attempts++ < maxAttempts) {
            setTimeout(check, 50);
          } else {
            log("Timeout waiting for composer readiness");
          }
        };
        check();
      };

      waitForReady(() => {
        try {
          const composer = api.container.lookup("controller:composer");
          const site = api.container.lookup("service:site");
          const tags = getTagsFromUrl();

          // CATEGORY AUTO-SELECTION
          let categoryId = null;
          const categoryParam = params.get("category");

          if (categoryParam) {
            const category = site.categories.find(
              (c) => c.slug === categoryParam || c.id === parseInt(categoryParam)
            );
            if (category) {
              categoryId = category.id;
            }
          } else {
            const hiddenCategory = site.categories.find(
              (c) => c && c.name && c.name.toLowerCase() === "hidden"
            );
            if (hiddenCategory) {
              categoryId = hiddenCategory.id;
            }
          }

          // Open composer - template text will be applied by url-composer-templates.js
          composer.open({
            action: "createTopic",
            draftKey: "new_topic",
            categoryId: categoryId,
            tags: tags.length > 0 ? tags : null,
            title: template.title || "",
          });

          log("Composer opened successfully - template will be applied by url-composer-templates.js");
          
          // Start draft resurrection watcher just in case
          startDraftWatcher(composer);
          
        } catch (error) {
          log("Error opening composer:", error);
        }
      });
    });
  };

  // Run auto-open check on page changes
  api.onPageChange(() => {
    sessionStorage.removeItem(STORAGE_KEY_AUTO_OPEN_CHECKED);
    
    schedule("afterRender", () => {
      setTimeout(() => {
        autoOpenComposerIfNeeded();
      }, 500);
    });
  });

  // Initial check
  schedule("afterRender", () => {
    setTimeout(() => {
      autoOpenComposerIfNeeded();
    }, 1000);
  });
});
