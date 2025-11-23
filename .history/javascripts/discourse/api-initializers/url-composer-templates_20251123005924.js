import { apiInitializer } from "discourse/lib/api";
import { schedule } from "@ember/runloop";

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
    
    // Temporarily disable draft saving to prevent 409 conflicts
    const originalDraftKey = composerModel.get("draftKey");
    composerModel.set("draftKey", null); // Disable drafts temporarily
    
    // Set values without triggering auto-save
    composerModel.set("reply", template.text);
    
    // Set title if provided and composer is for creating a topic
    if (template.title && composerModel.get("creatingTopic")) {
      composerModel.set("title", template.title);
      log("Applied title:", template.title);
    }
    
    // Re-enable draft saving after a delay (gives user time to see template)
    setTimeout(() => {
      composerModel.set("draftKey", originalDraftKey);
      log("Draft saving re-enabled");
    }, 2000); // 2 second delay before allowing draft saves

    // Mark as applied so we don't re-apply on model changes
    sessionStorage.setItem(STORAGE_KEY_APPLIED, "true");
  };

  // Use composer:opened event instead of onShow hook (more reliable with Docuss)
  api.onAppEvent("composer:opened", () => {
    log("🔔 composer:opened event fired");

    // Use a longer delay to allow Docuss to fully set up the composer (category, tags, etc.)
    schedule("afterRender", () => {
      log("⏰ afterRender scheduled, starting 800ms delay");
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
      }, 800); // Increased delay to let Docuss finish its setup
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
