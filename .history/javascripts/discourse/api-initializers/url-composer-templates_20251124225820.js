import { apiInitializer } from "discourse/lib/api";
import { schedule } from "@ember/runloop";
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
          autoOpen: settings[`template_${i}_auto_open`],
        });
      }
    }
    return templates;
  };

  // Extract composer_template parameter from URL
  const getTemplateIdFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    return params.get("composer_template");
  };

  // Store template ID in sessionStorage when URL parameter is detected
  const storeTemplateIdFromUrl = () => {
    const templateId = getTemplateIdFromUrl();
    if (templateId) {
      sessionStorage.setItem(STORAGE_KEY_TEMPLATE_ID, templateId);
      log("Stored template ID from URL:", templateId);
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
    
    // Check if there's existing content (including draft content)
    if (currentContent.trim().length > 0 || currentTitle.trim().length > 0) {
      log("Composer already has content or title, skipping template");
      // Clear the template ID to prevent re-application
      sessionStorage.removeItem(STORAGE_KEY_TEMPLATE_ID);
      return;
    }

    log("Applying template:", template.id);
    
    // Delete any existing draft first to prevent conflicts
    const draftKey = composerModel.get("draftKey");
    if (draftKey) {
      log("Deleting existing draft before applying template");
      ajax(`/drafts/${draftKey}.json`, { type: "DELETE" })
        .then(() => log("Existing draft deleted"))
        .catch((e) => {
          if (e.jqXHR?.status !== 404) {
            log("Draft deletion warning:", e);
          }
        });
    }
    
    // Temporarily disable auto-save to prevent 409 draft conflicts
    // This gives the template time to apply before Discourse tries to save
    const originalSaveDraft = composerModel.saveDraft;
    let saveBlocked = true;
    composerModel.saveDraft = function() {
      if (saveBlocked) {
        log("Draft save blocked during template application");
        return;
      }
      return originalSaveDraft.apply(composerModel, arguments);
    };
    
    // Set values - apply template content
    composerModel.set("reply", template.text);
    
    // Set title if provided and composer is for creating a topic
    if (template.title && composerModel.get("creatingTopic")) {
      composerModel.set("title", template.title);
      log("Applied title:", template.title);
    }

    // Re-enable draft saving after a delay (1000ms)
    // This allows the template to fully apply and draft deletion to complete
    setTimeout(() => {
      saveBlocked = false;
      log("Draft saving re-enabled");
      
      // Force a clean save to create new draft after template application
      schedule("afterRender", () => {
        if (composerModel && !composerModel.isDestroyed && !composerModel.isDestroying) {
          composerModel.saveDraft();
          log("Triggered manual draft save after template application");
        }
      });
    }, 1000);

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
      }
    }, 100);
  });

  // Initial URL parameter check
  schedule("afterRender", () => {
    storeTemplateIdFromUrl();
  });

  log("Initialization complete");
});
