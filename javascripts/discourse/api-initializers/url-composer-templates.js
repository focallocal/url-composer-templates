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
        log("📨 Stored template ID from postMessage:", templateId);
        // Trigger auto-open after short delay to allow page transition
        setTimeout(() => {
          if (settings.enable_auto_open_composer) {
            autoOpenComposerIfNeeded();
          }
        }, 500);
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
    if (currentContent.trim().length > 0) {
      log("Composer already has content, skipping template");
      return;
    }

    log("Applying template:", template.id);
    composerModel.set("reply", template.text);

    // Mark as applied so we don't re-apply on model changes
    sessionStorage.setItem(STORAGE_KEY_APPLIED, "true");
  };

  // Intercept composer open events
  api.modifyClass("controller:composer", {
    pluginId: "url-composer-templates",

    onShow() {
      this._super(...arguments);

      schedule("afterRender", () => {
        const templateId = sessionStorage.getItem(STORAGE_KEY_TEMPLATE_ID);
        const alreadyApplied = sessionStorage.getItem(STORAGE_KEY_APPLIED);

        if (!templateId || alreadyApplied) {
          return;
        }

        const template = findTemplate(templateId);
        if (!template) {
          log("No matching template found for ID:", templateId);
          return;
        }

        const model = this.get("model");
        if (!model) return;

        const isCreatingTopic = model.get("creatingTopic");

        if (shouldApplyTemplate(template, isCreatingTopic)) {
          applyTemplate(model, template);
        } else {
          log("Template not applicable for current context:", {
            templateId,
            useFor: template.useFor,
            isCreatingTopic,
          });
        }
      });
    },

    onClose() {
      this._super(...arguments);
      // Clear applied flag when composer closes
      sessionStorage.removeItem(STORAGE_KEY_APPLIED);
    },
  });

  // Detect URL parameter changes on page navigation
  api.onPageChange((url, title) => {
    // Clear the applied flag on page change
    sessionStorage.removeItem(STORAGE_KEY_APPLIED);

    // Check for new template ID in URL
    const templateId = storeTemplateIdFromUrl();
    if (templateId) {
      log("Page changed with template ID:", templateId);
    }
  });

  // Initial URL parameter check
  schedule("afterRender", () => {
    storeTemplateIdFromUrl();
  });

  log("Initialization complete");
});
