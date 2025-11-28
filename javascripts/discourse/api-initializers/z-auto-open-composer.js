import { apiInitializer } from "discourse/lib/api";
import { schedule } from "@ember/runloop";

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

  // Auto-open composer if conditions are met
  const autoOpenComposerIfNeeded = () => {
    const params = new URLSearchParams(window.location.search);
    const templateId = params.get(settings.template_param_key);
    const hasTopics = params.get("has_topics") === "true";
    
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
      if (!currentUrl.includes(template.urlMatch)) {
        log("URL doesn't match template url_match:", template.urlMatch);
        return;
      }
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
    }

    if (shouldOpen) {
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

            // Open composer
            composer.open({
              action: "createTopic",
              draftKey: "new_topic",
              categoryId: categoryId,
              tags: tags.length > 0 ? tags : null,
            });

            log("Composer opened successfully");
            
          } catch (error) {
            log("Error opening composer:", error);
          }
        });
      });
    }
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
