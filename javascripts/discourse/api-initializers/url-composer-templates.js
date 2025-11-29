import { apiInitializer } from "discourse/lib/api";
import { schedule, cancel } from "@ember/runloop";
import { ajax } from "discourse/lib/ajax";

export default apiInitializer("1.8.0", (api) => {
  if (!settings.enable_url_composer_templates) {
    return;
  }

  const log = (...args) => {
    if (settings.debug_mode) {
      console.log(" [URL Composer Templates]", ...args);
    }
  };

  log("Initializing");

  // Storage keys
  const STORAGE_KEY_TEMPLATE_ID = "url_composer_template_id";
  const STORAGE_KEY_APPLIED = "url_composer_template_applied";
  const STORAGE_KEY_USER_POSTED = "url_composer_user_posted";
  const STORAGE_KEY_MESSAGE_TS = "url_composer_message_ts";
  
  // Draft resurrection watcher (shared with z-auto-open-composer.js)
  let draftWatchInterval = null;
  
  const startDraftWatcher = (composerModel) => {
    if (draftWatchInterval) {
      clearInterval(draftWatchInterval);
    }
    
    log("Starting draft resurrection watcher");
    
    draftWatchInterval = setInterval(() => {
      if (!composerModel || !composerModel.draftKey) {
        log("Draft cleared or composer closed, stopping watcher");
        clearInterval(draftWatchInterval);
        draftWatchInterval = null;
        return;
      }
      
      const templateApplied = sessionStorage.getItem(STORAGE_KEY_APPLIED);
      if (!templateApplied) {
        return;
      }
      
      const draftKey = composerModel.draftKey;
      if (draftKey && draftKey !== "new_topic") {
        log("Draft resurrection detected, clearing draftKey:", draftKey);
        composerModel.set("draftKey", "new_topic");
      }
    }, 50);
  };

  // Listen for composer template from iframe via postMessage
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'dcs-composer-template') {
      const templateId = event.data.template;
      const hasTopics = event.data.hasTopics;
      const triggerId = event.data.triggerId;
      
      if (templateId) {
        sessionStorage.setItem(STORAGE_KEY_TEMPLATE_ID, templateId);
        sessionStorage.setItem('url_composer_has_topics', hasTopics ? 'true' : 'false');
        sessionStorage.setItem('url_composer_trigger_id', triggerId || '');
        sessionStorage.setItem(STORAGE_KEY_MESSAGE_TS, Date.now().toString());
        
        // Clear applied flag to allow new template application
        sessionStorage.removeItem(STORAGE_KEY_APPLIED);
        log("📨 Stored template ID from postMessage:", templateId, "hasTopics:", hasTopics, "triggerId:", triggerId);
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
          mode: settings[`template_${i}_mode`] || "ifNoTopics",
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
    // Check if we recently received a postMessage (within 2 seconds)
    const messageTs = parseInt(sessionStorage.getItem(STORAGE_KEY_MESSAGE_TS) || "0");
    if (Date.now() - messageTs < 2000) {
      log("Skipping URL template check - postMessage received recently");
      return sessionStorage.getItem(STORAGE_KEY_TEMPLATE_ID);
    }

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

    // Only apply if composer is empty or doesn't already have this template
    const currentContent = composerModel.get("reply") || "";
    
    // Check if template is already applied (exact match or contains template text)
    if (currentContent.includes(template.text.trim())) {
      log("Template already applied (content contains template text), skipping");
      sessionStorage.setItem(STORAGE_KEY_APPLIED, "true");
      return;
    }
    
    // Check if there's other existing content
    if (currentContent.trim().length > 0 && !currentContent.includes(template.text.trim())) {
      log("Composer already has different content, skipping template");
      sessionStorage.removeItem(STORAGE_KEY_TEMPLATE_ID);
      return;
    }

    log("Applying template:", template.id);
    
    // Wait for Docuss navigation to complete before setting content
    let timeoutId = null;
    let applied = false;
    
    const applyContent = () => {
      if (applied) return;
      applied = true;
      
      if (timeoutId) clearTimeout(timeoutId);
      
      const composerController = api.container.lookup("controller:composer");
      const targetModel = composerController?.model || composerController?.get?.("model") || composerModel;

      schedule("afterRender", () => {
        if (targetModel.isDestroyed || targetModel.isDestroying) return;
        
        targetModel.set("reply", template.text);
        
        if (template.title && targetModel.get("creatingTopic")) {
          targetModel.set("title", template.title);
          log("Applied title:", template.title);
        }
        
        log("Template applied to model", targetModel === composerModel ? "(original)" : "(swapped)", ", Discourse will auto-save normally");
      });
    };
    
    // Check if model has __dcsNavigatedToTag flag set by Docuss
    const checkAndApply = () => {
      if (applied) return;
      
      // Always get the latest model instance from the controller
      // This is crucial because navigation might swap the model instance
      const composerController = api.container.lookup("controller:composer");
      const currentModel = composerController?.model || composerController?.get?.("model");

      if (!currentModel || currentModel.isDestroyed || currentModel.isDestroying) return;
      
      // Check if the original model signaled navigation
      if (composerModel.__dcsNavigatedToTag) {
        // Give a small buffer for any navigation-triggered saves to start
        setTimeout(() => {
          if (applied) return;
          
          // Re-fetch current model in case it changed during timeout
          const latestModel = composerController?.model || composerController?.get?.("model");
          if (!latestModel || latestModel.isDestroyed || latestModel.isDestroying) return;

          // Check isSaving on the LATEST model
          if (latestModel.get("isSaving")) {
            log("Composer (latest) is saving, waiting...");
            setTimeout(checkAndApply, 100);
            return;
          }

          if (latestModel !== composerModel) {
            log("Composer model was swapped during navigation. Applying to new model.");
          }

          log("Docuss navigation complete and no save in progress, applying template");
          applyContent();
        }, 250);
      } else {
        // Check again in 50ms if Docuss is still navigating
        setTimeout(checkAndApply, 50);
      }
    };
    
    // Start checking (with timeout fallback)
    timeoutId = setTimeout(() => {
      if (!applied) {
        log("Docuss navigation timeout, applying template anyway");
        applyContent();
      }
    }, 1000); // 1 second max wait
    
    checkAndApply();

    // Mark as applied so we don't re-apply on model changes
    sessionStorage.setItem(STORAGE_KEY_APPLIED, "true");
  };

  // Use composer:opened event instead of onShow hook (more reliable with Docuss)
  api.onAppEvent("composer:opened", () => {
    log(" composer:opened event fired");

    // Apply template immediately when composer is ready - no delay needed
    schedule("afterRender", () => {
      log(" afterRender scheduled, checking template");
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
        // Apply template immediately - no delay, no draft conflicts
        applyTemplate(model, template);
      } else {
        log("Template not applicable for current context:", {
          templateId,
          useFor: template.useFor,
          isCreatingTopic,
        });
      }
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

  // Notify fl-maps iframe when user posts so bubble count can update
  api.onAppEvent("composer:posted", () => {
    const triggerId = sessionStorage.getItem('url_composer_trigger_id');
    if (!triggerId) return;
    
    log("📨 Post successful, notifying fl-maps iframe:", triggerId);
    
    // Find fl-maps iframe and send postMessage
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(iframe => {
      try {
        if (iframe.src && iframe.src.includes('fl-maps.publichappinessmovement.com')) {
          iframe.contentWindow.postMessage({
            type: 'dcs-topic-posted',
            triggerId: triggerId
          }, 'https://fl-maps.publichappinessmovement.com');
          log("✅ Message sent to fl-maps iframe");
        }
      } catch (e) {
        log("⚠️ Could not send message to iframe:", e);
      }
    });
  });

  // Detect URL parameter changes on page navigation
  let pageChangeTimeout;
  api.onPageChange((url, title) => {
    // Debounce page change events to prevent multiple rapid executions
    clearTimeout(pageChangeTimeout);
    pageChangeTimeout = setTimeout(() => {
      // Don't clear applied flag if composer is open - prevents re-applying template
      const composerController = api.container.lookup("controller:composer");
      const isComposerOpen = composerController?.model?.viewOpen;
      
      if (!isComposerOpen) {
        // Only clear applied flag when composer is closed
        sessionStorage.removeItem(STORAGE_KEY_APPLIED);
      }

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
