import { apiInitializer } from "discourse/lib/api";
import { schedule } from "@ember/runloop";
import { ajax } from "discourse/lib/ajax";

export default apiInitializer("1.8.0", (api) => {
  console.log("🚀🚀🚀 AUTO-OPEN COMPOSER LOADED - VERSION 2.1.0 🚀🚀🚀");
  
  if (!settings.enable_url_composer_templates || !settings.enable_auto_open_composer) {
    console.log("🚀 Auto-open disabled via settings");
    return;
  }

  const log = (...args) => {
    if (settings.debug_mode) {
      console.log("🚀 [Auto-Open Composer]", ...args);
    }
  };

  log("Initializing auto-open logic");

  const STORAGE_KEY_TEMPLATE_ID = "url_composer_template_id";
  const STORAGE_KEY_AUTO_OPEN_CHECKED = "url_composer_auto_open_checked";
  
  // Topic creation cache - prevents duplicate opens when search index lags
  // Key: "username:tag1+tag2" or "any:tag1+tag2", Value: { timestamp, exists: true }
  const topicCreationCache = new Map();
  const CACHE_DURATION_MS = 5000; // 5 seconds

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
          mode: settings[`template_${i}_mode`] || "ifUserHasNoTopic",
          useFor: settings[`template_${i}_use_for`] || "both"
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

  // Check if a topic exists with the current tags
  const checkTopicExists = async (tags, mode) => {
    if (!tags || tags.length === 0) {
      log("No tags found, skipping topic check");
      return true; // Assume topic exists if no tags
    }

    const currentUser = api.getCurrentUser();
    if (!currentUser) {
      log("No current user, skipping topic check");
      return true; // Don't auto-open if user not logged in
    }

    // Check cache first
    const tagsKey = tags.join("+");
    const cacheKey = mode === "ifUserHasNoTopic" 
      ? `${currentUser.username}:${tagsKey}`
      : `any:${tagsKey}`;
    
    const cached = topicCreationCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION_MS) {
      log(`Using cached result for ${cacheKey}:`, cached.exists);
      return cached.exists;
    }

    try {
      // Build search query based on mode
      const searchQuery = mode === "ifUserHasNoTopic"
        ? `tags:${tagsKey} @${currentUser.username}`
        : `tags:${tagsKey}`;
      
      log(`🔍 Search query (mode=${mode}): ${searchQuery}`);
      
      const response = await ajax(`/search.json`, {
        data: {
          q: searchQuery,
          type: "topic",
        },
      });

      const topicExists = response?.topics && response.topics.length > 0;
      
      // Cache result
      topicCreationCache.set(cacheKey, {
        timestamp: Date.now(),
        exists: topicExists
      });
      
      log("Topic check result:", { 
        tags, 
        mode,
        username: currentUser.username,
        searchQuery,
        topicExists, 
        count: response?.topics?.length || 0 
      });
      
      return topicExists;
    } catch (error) {
      log("Error checking for topics:", error);
      return true; // Assume topic exists on error to avoid unwanted composer opens
    }
  };

  // Auto-open composer if conditions are met
  const autoOpenComposerIfNeeded = async () => {
    const templateId = sessionStorage.getItem(STORAGE_KEY_TEMPLATE_ID);
    const alreadyChecked = sessionStorage.getItem(STORAGE_KEY_AUTO_OPEN_CHECKED);

    // Only check once per page load, and only if a template parameter exists
    if (alreadyChecked || !templateId) {
      return;
    }

    // Mark as checked
    sessionStorage.setItem(STORAGE_KEY_AUTO_OPEN_CHECKED, "true");

    log("Checking if we should auto-open composer for Docuss link with template:", templateId);

    // Get template settings
    const template = getTemplateSettings(templateId);
    if (!template) {
      log("Template not found or not enabled:", templateId);
      return;
    }

    // Check if URL matches (if url_match is configured)
    if (template.urlMatch) {
      const currentUrl = window.location.pathname + window.location.search;
      if (!currentUrl.includes(template.urlMatch)) {
        log("URL doesn't match template url_match:", template.urlMatch);
        return;
      }
      log("URL matches template url_match:", template.urlMatch);
    }

    const tags = getTagsFromUrl();
    
    // Check mode to determine if we should open
    let shouldOpen = false;
    
    if (template.mode === "always") {
      shouldOpen = true;
      log("Mode is 'always', will open composer");
    } else {
      const topicExists = await checkTopicExists(tags, template.mode);
      shouldOpen = !topicExists;
      log(`Mode is '${template.mode}', topicExists=${topicExists}, shouldOpen=${shouldOpen}`);
    }

    if (shouldOpen) {
      log("Opening composer for template:", template);

      schedule("afterRender", () => {
        // Poll for composer and site readiness instead of fixed delay
        // This is faster on good connections while still safe on slow ones
        const waitForReady = (callback, maxAttempts = 20) => {
          let attempts = 0;
          const check = () => {
            const composer = api.container.lookup("controller:composer");
            const site = api.container.lookup("service:site");
            const currentUser = api.getCurrentUser();
            
            if (composer && site && site.categories && currentUser) {
              log(`Ready after ${attempts * 50}ms (${attempts} checks)`);
              callback();
            } else if (attempts++ < maxAttempts) {
              setTimeout(check, 50); // Check every 50ms, max 1 second
            } else {
              log("Timeout waiting for composer readiness");
            }
          };
          check();
        };

        waitForReady(() => {
          try {
            const composer = api.container.lookup("controller:composer");
            const currentUser = api.getCurrentUser();
            const site = api.container.lookup("service:site");

            // CATEGORY AUTO-SELECTION FOR TEMPLATE FORMS
            // Determine category - prioritize "hidden" for Docuss template forms
            // This prevents conflicts with Docuss plugin's category assignment
            let categoryId = null;
            const params = new URLSearchParams(window.location.search);
            const categoryParam = params.get("category");

            if (categoryParam) {
              // Use category from URL parameter if provided
              const category = site.categories.find(
                (c) => c.slug === categoryParam || c.id === parseInt(categoryParam)
              );
              if (category) {
                categoryId = category.id;
              }
            } else {
              // No category param - auto-select "hidden" category for template forms
              // This is specifically for Docuss-based template forms where we want
              // posts to go to the Hidden category by default
              const hiddenCategory = site.categories.find(
                (c) => c && c.name && c.name.toLowerCase() === "hidden"
              );
              if (hiddenCategory) {
                categoryId = hiddenCategory.id;
                log("Auto-selected hidden category for template form:", categoryId);
              }
              // NOTE: To use a different category, modify the .find() condition above.
              // For example, to use "General" category:
              //   (c) => c && c.name && c.name.toLowerCase() === "general"
            }

            // Open composer with category already set to prevent post-open changes
            composer.open({
              action: "createTopic",
              draftKey: "new_topic",
              categoryId: categoryId,
              tags: tags.length > 0 ? tags : null,
            });

            log("Composer opened successfully with category:", categoryId);
            
            // Start draft resurrection watcher
            startDraftWatcher(composer);
          } catch (error) {
            log("Error opening composer:", error);
          }
        });
      });
    } else {
      log("Conditions not met, not auto-opening composer");
    }
  };

  // Watch for draft resurrection and kill it
  let draftWatchInterval = null;
  const STORAGE_KEY_APPLIED = "url_composer_template_applied";
  
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
      
      // Check if template was applied (meaning we want to block saves)
      const templateApplied = sessionStorage.getItem(STORAGE_KEY_APPLIED);
      if (!templateApplied) {
        // Template hasn't been applied yet, keep watching
        return;
      }
      
      // If draft is trying to resurrect, kill it
      const draftKey = model.draftKey;
      if (draftKey && draftKey !== "new_topic") {
        log("Draft resurrection detected, clearing draftKey:", draftKey);
        model.set("draftKey", null);
      }
    }, 50); // Check every 50ms
  };

  // Run auto-open check on page changes
  api.onPageChange(() => {
    // Check if composer is already open - if so, don't trigger another auto-open
    // This prevents closing an open composer when page changes are triggered by opening it
    const composer = api.container.lookup("controller:composer");
    if (composer && composer.get("model")) {
      log("Composer already open, skipping auto-open check on page change");
      return;
    }

    // Clear the checked flag so we can check again on new page
    sessionStorage.removeItem(STORAGE_KEY_AUTO_OPEN_CHECKED);

    // Delay to ensure page is fully loaded
    schedule("afterRender", () => {
      setTimeout(() => {
        autoOpenComposerIfNeeded();
      }, 500);
    });
  });

  // Initial check - increased delay to ensure url-composer-templates hooks are attached
  schedule("afterRender", () => {
    setTimeout(() => {
      autoOpenComposerIfNeeded();
    }, 1500);
  });

  log("Auto-open initialization complete");
});
