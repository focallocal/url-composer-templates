# URL Composer Templates v2.0 - Implementation Summary

## Completed Changes

### 1. Settings Schema (`settings.yml`)

**Added:**
- `url_patterns` (list): New pattern-based configuration system
  - Format: `urlPattern|templateId|mode|timing`
  - Example: `/tags/intersection|going|ifUserHasNoTopic|first`

**Deprecated (marked but kept for backward compatibility):**
- `auto_open_check_user_only`
- All `template_N_url_match` fields
- All `template_N_use_for` fields

### 2. Auto-Open Logic (`z-auto-open-composer.js`)

**New Features:**

#### Pattern Parsing System
- `parseUrlPatterns()`: Parses pipe-separated patterns from settings
- `findMatchingPattern()`: Matches current URL against patterns
- Validates mode and timing values

#### Three Opening Modes
1. **`always`**: Opens every time, regardless of existing topics
2. **`ifNoTopics`**: Opens only if NO topics exist with these tags (any user)
3. **`ifUserHasNoTopic`**: Opens only if current user hasn't created a topic

#### Topic Creation Cache
- Prevents duplicate opens when Discourse search index lags
- 5-second TTL per username:tags combination
- Cache keys:
  - `ifUserHasNoTopic`: `"username:tag1+tag2"`
  - `ifNoTopics`: `"any:tag1+tag2"`

#### Draft Resurrection Prevention
- `startDraftWatcher()`: Monitors composer model every 50ms
- Detects when `draftKey` changes from `"new_topic"`
- Immediately clears resurrection attempts
- Stops watching when composer closes

**Updated Functions:**
- `checkTopicExists()`: Now uses mode parameter and cache
- `autoOpenComposerIfNeeded()`: Uses pattern-based logic instead of boolean flags

### 3. Documentation (`MIGRATION_V2.md`)

Created comprehensive migration guide including:
- Breaking changes explanation
- Migration examples (old vs new format)
- Common use cases with real-world examples
- Testing procedures for all three modes
- Technical details on draft prevention and caching
- Rollback plan if issues occur

## Key Improvements Over v1.x

### Problem 1: Draft Resurrection
**v1.x:** Used `setTimeout(500)` to block saves (unreliable)
**v2.0:** Active watcher with 50ms polling (reliable)

### Problem 2: Search Index Lag
**v1.x:** No cache, could reopen composer immediately after posting
**v2.0:** 5-second cache prevents duplicate opens

### Problem 3: Limited Flexibility
**v1.x:** Only two modes via boolean (`checkUserOnly` true/false)
**v2.0:** Three modes with clear semantics (`always`, `ifNoTopics`, `ifUserHasNoTopic`)

### Problem 4: Hardcoded Template Limit
**v1.x:** Maximum 6 templates
**v2.0:** Unlimited patterns via list setting

## Files Modified

1. **`settings.yml`**
   - Added `url_patterns` list
   - Marked 18 settings as deprecated
   - Added inline documentation

2. **`javascripts/discourse/api-initializers/z-auto-open-composer.js`**
   - Version bumped to 2.0.0
   - Added 4 new functions
   - Refactored auto-open logic
   - Added cache and draft watcher

3. **`MIGRATION_V2.md`** (new file)
   - 200+ line migration guide
   - Examples and use cases
   - Testing procedures

## Testing Checklist

Before deploying to production:

- [ ] Test `always` mode - composer opens every time
- [ ] Test `ifNoTopics` mode - stops after first topic by any user
- [ ] Test `ifUserHasNoTopic` mode - stops after current user posts
- [ ] Verify draft watcher prevents resurrection (check console logs)
- [ ] Verify cache prevents duplicate opens (post, immediately revisit URL)
- [ ] Test with multiple patterns for same template
- [ ] Test backward compatibility with old settings
- [ ] Enable `debug_mode` and review console logs

## Console Logging

With `debug_mode: true`, you'll see:

```
🚀🚀🚀 AUTO-OPEN COMPOSER LOADED - VERSION 2.0.0 🚀🚀🚀
🚀 [Auto-Open Composer] Initializing auto-open logic
🚀 [Auto-Open Composer] Parsed patterns: [{...}]
🚀 [Auto-Open Composer] Matched pattern: {...} for URL: /tags/intersection/...
🚀 [Auto-Open Composer] Mode is 'ifUserHasNoTopic', topicExists=false, shouldOpen=true
🚀 [Auto-Open Composer] Starting draft resurrection watcher
🚀 [Auto-Open Composer] Draft resurrection detected, clearing draftKey: draft_...
```

## Rollback Instructions

If critical issues arise:

1. Revert `z-auto-open-composer.js` to previous version
2. Revert `settings.yml` to previous version
3. Old `template_N_url_match` settings will work again
4. Note: Draft resurrection and cache issues will return

## Next Steps

1. **Deploy to staging** and test all three modes
2. **Monitor console logs** for pattern parsing errors
3. **Convert existing URL patterns** from old format to new format
4. **Update admin documentation** to reference MIGRATION_V2.md
5. **Collect user feedback** on draft behavior improvements

## Version Info

- **Version**: 2.0.0
- **Release Date**: 2025-01-27
- **Breaking Changes**: Settings schema (backward compatible)
- **New Features**: 3 modes, draft watcher, search cache, unlimited patterns

