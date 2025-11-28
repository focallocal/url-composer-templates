import { apiInitializer } from "discourse/lib/api";
import { schedule, cancel } from "@ember/runloop";
import { ajax } from "discourse/lib/ajax";

export default apiInitializer("1.8.0", (api) => {
  if (!settings.enable_url_composer_templates) {
    return;
  }

  const log = (...args) => {
    if (settings.debug_mode) {
      console.log("🎨 [URL Composer Templates]", ...args);
    }
  };

  log("Initializing");

  // Storage keys
  const STORAGE_KEY_TEMPLATE_ID = "url_composer_template_id";
  const STORAGE_KEY_APPLIED = "url_composer_template_applied";
  const STORAGE_KEY_USER_POSTED = "url_composer_user_posted";

  // Helper to get tags from URL (duplicated from z-auto-open-composer.js)
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

  // Listen for composer template from iframe via postMessage
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'dcs-composer-template') {
      const templateId = event.data.template;
      if (templateId) {
        sessionStorage.setItem(STORAGE_KEY_TEMPLATE_ID, templateId);
        // Clear applied flag to allow new template application
        sessionStorage.removeItem(STORAGE_KEY_APPLIED);
        log("📨 Stored template ID from postMessage:", templateId);
        // Note: Don't auto-open here - let Docuss/DCSLink handle composer opening
        // Template will be applied when composer opens via onShow() hook
      }
    }
  });

  // Get all enabled templates from settings
  const getEnabledTemplates = () => {
    const templates = [];
    for (let i = 1; i <= 6; i++) {
      const enabled = settings[`template_${i}_enabled`];
      if (enabled) {
        templates.push({
          id: settings[`template_${i}_id`],
          title: settings[`template_${i}_title`],
          text: settings[`template_${i}_text`],
          useFor: settings[`template_${i}_use_for`],
          mode: settings[`template_${i}_mode`] || "ifUserHasNoTopic",
          autoOpen: settings[`template_${i}_auto_open`],
          urlMatch: (settings[`template_${i}_url_match`] || "").trim(),
        });
      }
    }
    return templates;
  };

  // Extract composer_template parameter from URL
  const getTemplateIdFromUrl = () => {
    const paramKey = (settings.template_param_key || "").trim();
    if (!paramKey) {
      return null;
    }
    const params = new URLSearchParams(window.location.search);
    return params.get(paramKey);
  };

  const getTemplateIdFromPath = () => {
    const templates = getEnabledTemplates();
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const match = templates.find((template) => template.urlMatch && currentUrl.includes(template.urlMatch));
    return match ? match.id : null;
  };

  // Store template ID in sessionStorage when URL parameter is detected
  const storeTemplateIdFromUrl = () => {
    const templateId = getTemplateIdFromUrl() || getTemplateIdFromPath();
    if (templateId) {
      sessionStorage.setItem(STORAGE_KEY_TEMPLATE_ID, templateId);
      log("Stored template ID from URL or path:", templateId);
      return templateId;
    }
    return sessionStorage.getItem(STORAGE_KEY_TEMPLATE_ID);
  };

  // Find matching template by ID
  const findTemplate = (templateId) => {
    if (!templateId) return null;
    const templates = getEnabledTemplates();
    return templates.find((t) => t.id === templateId) || null;
  };

  // Check if we should apply template based on context
  const shouldApplyTemplate = (template, isCreatingTopic) => {
    if (!template) return false;

    const useFor = template.useFor;
    if (useFor === "both") return true;
    if (useFor === "first_post" && isCreatingTopic) return true;
    if (useFor === "all_replies" && !isCreatingTopic) return true;

    return false;
  };

  // Apply template to composer
  const applyTemplate = (composerModel, template) => {
    if (!composerModel || !template) return;

    // Only apply if composer is empty or has default text
    const currentContent = composerModel.get("reply") || "";
    const currentTitle = composerModel.get("title") || "";
    
    // Check if there's existing content (allow title from Docuss/elsewhere)
    if (currentContent.trim().length > 0) {
      log("Composer already has content, skipping template");
      // Clear the template ID to prevent re-application
      sessionStorage.removeItem(STORAGE_KEY_TEMPLATE_ID);
      return;
    }

    log("Applying template:", template.id);
    
    // Cancel any pending draft saves to prevent 409 conflicts
    if (composerModel._saveDraftDebounce) {
      cancel(composerModel._saveDraftDebounce);
      composerModel._saveDraftDebounce = null;
      log("Cancelled pending draft save debounce");
    }

    // Temporarily disable auto-save to prevent 409 draft conflicts
    const originalSaveDraft = composerModel.saveDraft;
    let saveBlocked = true;
    composerModel.saveDraft = function() {
      if (saveBlocked) {
        log("Draft save blocked during template application");
        return Promise.resolve();
      }
      return originalSaveDraft.apply(composerModel, arguments);
    };
    
    // Delete any existing draft first to prevent conflicts
    const draftKey = composerModel.get("draftKey");
    
    // Only delete if it's a persisted draft (not new_topic) to avoid "edited in another window" errors
    const shouldDelete = draftKey && draftKey !== "new_topic";
    
    const deleteDraftPromise = shouldDelete
      ? ajax(`/drafts/${draftKey}.json`, { type: "DELETE" })
          .then(() => {
            log("Existing draft deleted");
          })
          .catch((e) => {
            if (e.jqXHR?.status !== 404) {
              log("Draft deletion warning:", e);
            }
          })
      : Promise.resolve();
    
    // Set template values
    composerModel.set("reply", template.text);
    
    if (template.title && composerModel.get("creatingTopic")) {
      composerModel.set("title", template.title);
      log("Applied title:", template.title);
    }

    // Re-enable draft saving after deletion completes
    deleteDraftPromise.finally(() => {
      // Add delay before re-enabling to prevent race conditions with Discourse's auto-save
      setTimeout(() => {
        schedule("afterRender", () => {
          saveBlocked = false;
          log("Draft saving re-enabled after delay");
        });
      }, 500);
    });

    // Mark as applied so we don't re-apply on model changes
    sessionStorage.setItem(STORAGE_KEY_APPLIED, "true");
  };

  // Use composer:opened event instead of onShow hook (more reliable with Docuss)
  api.onAppEvent("composer:opened", () => {
    log("🔔 composer:opened event fired");

    // Use a short delay to allow Docuss to set up category/tags, but template applies immediately
    schedule("afterRender", () => {
      log("⏰ afterRender scheduled, starting 200ms delay");
      setTimeout(() => {
        log("✅ setTimeout completed, checking template");
        const templateId = sessionStorage.getItem(STORAGE_KEY_TEMPLATE_ID);
        const alreadyApplied = sessionStorage.getItem(STORAGE_KEY_APPLIED);
        log("Template state:", { templateId, alreadyApplied });

        if (!templateId || alreadyApplied) {
          log("Skipping: no template ID or already applied");
          return;
        }

        const template = findTemplate(templateId);
        if (!template) {
          log("No matching template found for ID:", templateId);
          return;
        }

        const composerController = api.container.lookup("controller:composer");
        const model = composerController?.model || composerController?.get?.("model");
        if (!model) {
          log("No composer model found");
          return;
        }

        // Check if we should close the composer because the user already posted
        if (template.mode === "ifUserHasNoTopic") {
          // Try to get tags from model first, then URL
          let tags = model.get("tags") || [];
          if (!tags || tags.length === 0) {
             tags = getTagsFromUrl();
          }
          
          const tagsKey = tags.join("+");
          const userPostedJson = sessionStorage.getItem(STORAGE_KEY_USER_POSTED);
          let hasPosted = false;
          
          if (userPostedJson) {
            try {
              const postedTags = JSON.parse(userPostedJson);
              if (Array.isArray(postedTags) && postedTags.includes(tagsKey)) {
                hasPosted = true;
              }
            } catch (e) {
              if (userPostedJson === tagsKey) hasPosted = true;
            }
          }

          if (hasPosted) {
            log("⛔ User has already posted to these tags, closing composer!");
            composerController.close();
            sessionStorage.removeItem(STORAGE_KEY_TEMPLATE_ID);
            return;
          }
        }

        const isCreatingTopic = model.get("creatingTopic");
        log("Composer context:", { isCreatingTopic, useFor: template.useFor });

        if (shouldApplyTemplate(template, isCreatingTopic)) {
          // Apply template immediately - we've disabled draft saving so no conflicts
          applyTemplate(model, template);
        } else {
          log("Template not applicable for current context:", {
            templateId,
            useFor: template.useFor,
            isCreatingTopic,
          });
        }
      }, 200); // Reduced delay - auto-open handles the longer wait
    });
  });

  // Clear applied flag when composer closes
  api.onAppEvent("composer:closed", () => {
    log("Composer closed, clearing applied flag");
    sessionStorage.removeItem(STORAGE_KEY_APPLIED);
  });

  // Clear template data when composer is about to close (before drafts save)
  api.onAppEvent("composer:will-close", () => {
    log("Composer will close, clearing template ID");
    sessionStorage.removeItem(STORAGE_KEY_TEMPLATE_ID);
    sessionStorage.removeItem(STORAGE_KEY_APPLIED);
  });

  // Clear template data when closing via X button or clicking away
  api.onAppEvent("composer:cancelled", () => {
    log("Composer cancelled, clearing all template data");
    sessionStorage.removeItem(STORAGE_KEY_TEMPLATE_ID);
    sessionStorage.removeItem(STORAGE_KEY_APPLIED);
  });

  // Detect URL parameter changes on page navigation
  let pageChangeTimeout;
  api.onPageChange((url, title) => {
    // Debounce page change events to prevent multiple rapid executions
    clearTimeout(pageChangeTimeout);
    pageChangeTimeout = setTimeout(() => {
      // Clear the applied flag on page change
      sessionStorage.removeItem(STORAGE_KEY_APPLIED);

      // Check for new template ID in URL
      const templateId = storeTemplateIdFromUrl();
      if (templateId) {
        log("Page changed with template ID:", templateId);
      } else {
        // If we navigated away from a template context (e.g. Docuss), close the composer
        // This fixes the issue where the composer stays open when leaving Docuss
        if (!url.includes("/tags/intersection/")) {
          const composerController = api.container.lookup("controller:composer");
          if (composerController && composerController.get("model")) {
            const model = composerController.get("model");
            // Only auto-close new topic drafts to avoid losing user work on replies
            if (model.draftKey === "new_topic") {
              log("Navigated away from Docuss context, closing composer");
              composerController.close();
            }
          }
        }
      }
    }, 100);
  });

  // Initial URL parameter check
  schedule("afterRender", () => {
    storeTemplateIdFromUrl();
  });

  log("Initialization complete");
});
