import { apiInitializer } from "discourse/lib/api";
import { schedule } from "@ember/runloop";
import { ajax } from "discourse/lib/ajax";

export default apiInitializer("1.8.0", (api) => {
  console.log("🚀🚀🚀 AUTO-OPEN COMPOSER LOADED - VERSION 2.0.0 🚀🚀🚀");
  
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
  // Key: "username:tag1+tag2", Value: { timestamp, exists: true }
  const topicCreationCache = new Map();
  const CACHE_DURATION_MS = 5000; // 5 seconds

  // Parse URL patterns from settings
  const parseUrlPatterns = () => {
    if (!settings.url_patterns) {
      log("No url_patterns configured");
      return [];
    }

    const patterns = settings.url_patterns
      .split("\n")
      .map(line => line.trim())
      .filter(line => line && !line.startsWith("#"))
      .map(line => {
        const parts = line.split("|").map(p => p.trim());
        if (parts.length !== 4) {
          log("Invalid pattern (expected 4 parts):", line);
          return null;
        }
        
        const [urlPattern, templateId, mode, timing] = parts;
        
        // Validate mode
        if (!["always", "ifNoTopics", "ifUserHasNoTopic"].includes(mode)) {
          log("Invalid mode (expected always/ifNoTopics/ifUserHasNoTopic):", mode);
          return null;
        }
        
        // Validate timing
        if (!["first", "replies", "both"].includes(timing)) {
          log("Invalid timing (expected first/replies/both):", timing);
          return null;
        }
        
        return { urlPattern, templateId, mode, timing };
      })
      .filter(Boolean);

    log("Parsed patterns:", patterns);
    return patterns;
  };

  // Find matching pattern for current URL
  const findMatchingPattern = () => {
    const currentUrl = window.location.pathname + window.location.search;
    const patterns = parseUrlPatterns();
    
    for (const pattern of patterns) {
      if (currentUrl.includes(pattern.urlPattern)) {
        log("Matched pattern:", pattern, "for URL:", currentUrl);
        return pattern;
      }
    }
    
    log("No pattern match for URL:", currentUrl);
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
  const checkTopicExists = async (tags) => {
    if (!tags || tags.length === 0) {
      log("No tags found, skipping topic check");
      return true; // Assume topic exists if no tags
    }

    try {
      const currentUser = api.getCurrentUser();
      if (!currentUser) {
        log("No current user, skipping topic check");
        return true; // Don't auto-open if user not logged in
      }

      const checkUserOnly = settings.auto_open_check_user_only;
      const tagsQuery = tags.join("+");
      
      // Build search query based on setting
      // If checkUserOnly is true: search ONLY for topics by THIS user
      // If checkUserOnly is false: search for topics by ANY user (all topics)
      const searchQuery = checkUserOnly 
        ? `tags:${tagsQuery} @${currentUser.username}`
        : `tags:${tagsQuery}`;
      
      log(`🔍 Search query (checkUserOnly=${checkUserOnly}): ${searchQuery}`);
      
      const response = await ajax(`/search.json`, {
        data: {
          q: searchQuery,
          type: "topic",
        },
      });

      const topicExists = response?.topics && response.topics.length > 0;
      log("Topic check result:", { 
        tags, 
        checkUserOnly,
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

    const tags = getTagsFromUrl();
    const topicExists = await checkTopicExists(tags);

    if (!topicExists) {
      log("No topic found, auto-opening composer");

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
          } catch (error) {
            log("Error opening composer:", error);
          }
        });
      });
    } else {
      log("Topic already exists, not auto-opening composer");
    }
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
