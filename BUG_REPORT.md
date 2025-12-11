# URL Composer Templates - Bug Report
**Date:** November 27-28, 2025  
**Component:** Discourse Theme Component - URL Composer Templates v2.1.0  
**Integration:** Docuss Plugin + URL Composer Templates

---

## Desired Behavior

### Template Application
1. **Initial Click**: When user clicks a Docuss button (e.g., "Going", "Report"), composer should open with:
   - Pre-filled title from Docuss
   - Pre-filled template text from URL parameter
   - Template applied immediately without user intervention

2. **Subsequent Behavior**: After user creates the topic:
   - Clicking the same button again should NOT reopen the composer
   - User should see the existing topic instead
   - Template should only apply on first use

3. **Template Modes**:
   - `use_for: "first_post"` - Apply only to first topic creation
   - `use_for: "all_replies"` - Apply to all replies in that topic
   - `use_for: "both"` - Apply to both scenarios

### SessionStorage Communication
- Docuss sets: `url_composer_template_id`, `url_composer_auto_open_checked`
- Template component reads and applies template
- Auto-open component handles composer opening logic
- Flags cleared appropriately after use

---

## Current Behavior (Broken)

**User Report:** "The composer fixes didn't work at all"

**Observed Issues:**
1. Template text not appearing when composer opens
2. Composer may reopen after user has already posted
3. Template application logic failing

---

## Bug Analysis & Fix Attempts

### **Bug #1: Template Text Not Applying When Title Exists**

**Root Cause:**  
`url-composer-templates.js` line 98 checked for BOTH content AND title:
```javascript
if (currentContent.trim().length > 0 || currentTitle.trim().length > 0)
```

Docuss pre-fills the title via URL parameter, so this condition blocked template text from being applied.

**Fix Applied (Commit 248bc3c):**
```javascript
// Changed to only check for existing content
if (currentContent.trim().length > 0)
```

**Expected Outcome:** Template text should now apply even when title is pre-filled  
**Actual Outcome:** ⚠️ User reports "didn't work at all"

---

### **Bug #2: Template Applied Flag Not Cleared**

**Root Cause:**  
`STORAGE_KEY_APPLIED` constant was undefined in `onPageChange` handler, causing:
```
Uncaught ReferenceError: STORAGE_KEY_APPLIED is not defined
```

**Fix Applied (Commit 778174e):**
- Moved all storage key constants to module scope:
  ```javascript
  const STORAGE_KEY_TEMPLATE_ID = 'url_composer_template_id'
  const STORAGE_KEY_AUTO_OPEN_CHECKED = 'url_composer_auto_open_checked'
  const STORAGE_KEY_APPLIED = 'url_composer_template_applied'
  const STORAGE_KEY_USER_POSTED = 'url_composer_user_posted'
  ```

**Expected Outcome:** No more JavaScript errors, flags cleared properly  
**Actual Outcome:** ⚠️ User reports "didn't work at all"

---

### **Bug #3-5: Composer Reopening After User Posted**

**Root Cause:**  
Multiple issues causing composer to reopen inappropriately:
1. Template cache expires after 5 seconds
2. Auto-open flag cleared on every page change
3. No persistent tracking of whether user already posted

**Fix Applied (Commit 778174e):**
1. Added `STORAGE_KEY_USER_POSTED` for persistent tracking
2. Modified `onPageChange` to preserve flags when user posted:
   ```javascript
   const userPosted = sessionStorage.getItem(STORAGE_KEY_USER_POSTED)
   if (!userPosted) {
     sessionStorage.removeItem(STORAGE_KEY_AUTO_OPEN_CHECKED)
   }
   ```
3. Set user-posted flag when topic created:
   ```javascript
   sessionStorage.setItem(STORAGE_KEY_USER_POSTED, 'true')
   ```

**Expected Outcome:** Composer should not reopen after user posts  
**Actual Outcome:** ⚠️ User reports "didn't work at all"

---

## Implementation Status

### Files Modified
1. `javascripts/discourse/api-initializers/url-composer-templates.js`
   - Fixed template text application logic (line 98)
   - Moved constants to module scope

2. `javascripts/discourse/api-initializers/z-auto-open-composer.js`
   - Added persistent user-posted tracking
   - Fixed constant scope issues
   - Modified flag clearing logic

### Commits Pushed
- **248bc3c**: "Resolve 5 critical bugs preventing templates from working"
- **778174e**: "Move STORAGE_KEY constants to top scope"

Both commits pushed to GitHub on November 27, 2025.

---

## Current Status: ❌ NOT WORKING

**User Feedback:** "didn't work at all"

### Possible Reasons for Failure

1. **Theme Component Not Enabled in Discourse**
   - User may not have enabled the theme component in Discourse settings
   - Component needs to be added to active theme

2. **Cache Issues**
   - Discourse may be serving cached JavaScript
   - Requires clearing cache or rebuilding assets

3. **Logic Errors in Fixes**
   - The fixes may have introduced new bugs
   - Template application timing might be wrong
   - SessionStorage communication broken

4. **Integration Issues**
   - Docuss plugin may not be setting storage keys correctly
   - URL parameters not being passed properly
   - Timing issues between Docuss and template component

5. **Missing Debug Information**
   - No console logs to verify execution flow
   - Can't confirm if code is even running
   - Need to enable debug mode to diagnose

---

## Next Steps for Diagnosis

1. **Enable Debug Mode**
   - Add console.log statements to verify code execution
   - Check if template ID is being received
   - Verify sessionStorage values

2. **Check Discourse Admin**
   - Verify theme component is enabled
   - Check for JavaScript errors in browser console
   - Rebuild Discourse assets

3. **Test Isolation**
   - Test template component independently (without Docuss)
   - Test with manual URL parameters
   - Verify basic composer opening works

4. **Review Integration**
   - Check Docuss plugin code that sets sessionStorage
   - Verify URL parameter format matches expected pattern
   - Test timing of storage key setting vs. component reading

---

## Additional Context

### Related Components
- **Docuss Plugin** (dcs-discourse-plugin): Sets initial sessionStorage values
- **URL Composer Templates**: Reads storage and applies templates
- **Discourse Composer**: Target component being manipulated

### Browser Environment
- SessionStorage used for cross-component communication
- Requires same-origin policy compliance
- May have timing dependencies on Discourse loading

### User Environment
- Discourse version: Unknown
- Browser: Unknown
- Theme setup: Unknown

---

**Report Status:** Awaiting user feedback on specific failure modes and environment details.
