import { apiInitializer } from "discourse/lib/api";
import { schedule } from "@ember/runloop";
import { ajax } from "discourse/lib/ajax";

export default apiInitializer("1.8.0", (api) => {
  if (!settings.enable_url_composer_templates || !settings.enable_auto_open_composer) {
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
      // Search for topics with ALL the current tags
      const tagsQuery = tags.join("+");
      const response = await ajax(`/search.json`, {
        data: {
          q: `tags:${tagsQuery}`,
          type: "topic",
        },
      });

      const topicExists = response?.topics && response.topics.length > 0;
      log("Topic check result:", { tags, topicExists, count: response?.topics?.length || 0 });
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
        // Add 800ms delay BEFORE opening composer to allow templates to be ready
        // This creates smoother UX - composer opens WITH template text already filled
        setTimeout(() => {
          try {
            const composer = api.container.lookup("controller:composer");
            const currentUser = api.getCurrentUser();

            if (!composer || !currentUser) {
              log("Composer or user not available");
              return;
            }

            // Determine category if we can
            let categoryId = null;
            const params = new URLSearchParams(window.location.search);
            const categoryParam = params.get("category");
            if (categoryParam) {
              const site = api.container.lookup("service:site");
              const category = site.categories.find((c) => c.slug === categoryParam || c.id === parseInt(categoryParam));
              if (category) {
                categoryId = category.id;
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
        }, 800); // Delay composer open to allow template system to prepare
      });
    } else {
      log("Topic already exists, not auto-opening composer");
    }
  };

  // Run auto-open check on page changes
  api.onPageChange(() => {
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
