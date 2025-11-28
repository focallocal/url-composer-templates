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

## Bug #6: Auto-Open Composer Always Triggers

**Root Cause:**  
The initializer watches for any tag/string in the URL and auto-opens a template in Discourse whenever it sees a match. This works when you *always* want to open a template, but breaks when you need conditions like:
- "Don't open if any topic already exists"
- "Don't open if this user already posted"

**What Was Attempted:**
1. **Conditional Search Flag** (`auto_open_check_user_only`):
   - When `true`: searches `tags:tag1+tag2 @username`
   - When `false`: searches `tags:tag1+tag2`
   - Goal: distinguish "any topic exists" vs. "this user's topic exists"

2. **500ms Draft Save Delay**:
   - Added delay before re-enabling draft saves
   - Intended to avoid clashes with Discourse's auto-save timer

3. **Basic Logging**:
   - Added `console.log` for trigger ID and template name
   - Limited visibility into decision flow

**Why It Failed:**
- Discourse search API returns results before the search index updates → system thinks "no topics exist" even right after posting
- `@username` filtering doesn't help if username doesn't match exactly or tags don't align
- Never cancels Discourse's pending `_saveDraft` timers → queued saves still fire after the 500ms block, resurrecting drafts
- Almost zero telemetry: no logs of search responses, matched tags, or decision paths

**Impact:**  
Users keep seeing the composer open even after they've already created a topic for that tag combination.

---

## Bug #7: Template Mode Confusion

**Root Cause:**  
No explicit modes for "always", "if no topics", or "if user has no topic". Logic is implicit and hard to reason about.

**Current Settings:**
- `auto_open_check_user_only: true/false` is binary and confusing
- Admin can't easily understand when templates will or won't apply

**Proposed Fix:**
Create three explicit modes in admin settings:

1. **`always`**: Opens template every time the tag(s) match (no searches, no checks)
2. **`ifNoTopics`**: Searches for any topic with these tags; only opens if none exist
3. **`ifUserHasNoTopic`**: Searches for topics by this specific user with these tags; only opens if user hasn't posted

**Expected Outcome:** Clear, predictable behavior that admins can configure without guessing

**Status:** Proposed, not yet implemented

---

## Recent Infrastructure Improvements (November 28, 2025)

### Standalone URL Matching
**Problem:** Component relied entirely on Docuss sending `?composer_template=X` query parameters.

**Solution:**
- Added `template_param_key` setting (defaults to `composer_template`) so admins can change the query parameter name or disable query-parameter detection entirely
- Added per-template `template_X_url_match` fields for substring matching
- Examples:
  - Set `template_1_url_match: "/tag/introductions"` → trigger when URL contains that path
  - Set `template_2_url_match: "/tags/intersection/going"` → trigger on specific tag intersection

**Files Modified:**
- `settings.yml`: Added `template_param_key` and 6 new `template_X_url_match` fields
- `url-composer-templates.js`: Added `getTemplateIdFromPath()` function, merged with query parameter detection
- `README.md`: Documented standalone usage, provided examples for non-Docuss workflows

**Commits:**
- Added configurable trigger settings (November 28, 2025)

**Status:** ✅ Implemented, awaiting user testing

---

## Next Steps for Diagnosis

1. **Enable Debug Mode**
   - Turn on `debug_mode` in theme settings
   - Check browser console for 🎨 emoji-prefixed logs
   - Verify template ID detection and application flow

2. **Check Discourse Admin**
   - Confirm theme component is enabled and added to active theme
   - Check for JavaScript errors in browser console
   - Rebuild Discourse assets if recently deployed

3. **Test Isolation**
   - Test with manual URL: `/?composer_template=report`
   - Test with URL substring: `/tags/intersection/going`
   - Verify basic composer opening without auto-open

4. **Implement Missing Fixes**
   - Add explicit template modes (`always`, `ifNoTopics`, `ifUserHasNoTopic`)
   - Cancel Discourse `_saveDraft` debounce after deleting drafts
   - Add comprehensive logging (search queries, results, decision tree)
   - Cache "user already posted" decisions per tag to handle search lag

---

## Additional Context

### Related Components
- **Docuss Plugin** (dcs-discourse-plugin): Sets initial sessionStorage values, passes `composer_template` query params
- **URL Composer Templates**: Reads URL/storage and applies templates
- **Auto-Open Composer** (z-auto-open-composer.js): Handles conditional composer opening
- **Discourse Composer**: Target component being manipulated

### Browser Environment
- SessionStorage used for cross-component communication
- Same-origin policy required
- Timing dependencies on Discourse's Ember lifecycle

### User Environment
- Discourse version: v3.6.0.beta3-latest
- Browser: Modern (supports ES6+)
- Theme: Multiple components active (Docuss, URL Composer Templates, Auto-Open, First Login Redirect)

---

## Summary of All Fixes to Date

| Bug | Fix Attempt | Outcome | Status |
|-----|-------------|---------|--------|
| Template text not applying | Removed title check (only check content) | ❌ User: "didn't work" | Needs investigation |
| Applied flag not cleared | Moved constants to module scope | ❌ User: "didn't work" | Needs investigation |
| Composer reopening | Added persistent user-posted tracking | ❌ User: "didn't work" | Needs investigation |
| Auto-open always triggers | Added search with @username filter | ❌ Still opens after posting | Search index lag |
| Draft save conflicts | 500ms delay before re-enable | ❌ Still seeing 409s | Doesn't cancel queued saves |
| No template mode clarity | Proposed 3 explicit modes | 🔄 Not implemented | Planned |
| Hard-coded trigger strings | Added configurable URL matching | ✅ Implemented | Awaiting test |

---

**Report Updated:** November 28, 2025  
**Status:** Multiple fixes applied, core issues persist. Requires debug logging and systematic testing to diagnose root cause.
