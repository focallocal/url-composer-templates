# URL Composer Templates v2.0 Migration Guide

## What's New in v2.0

Version 2.0 introduces a **flexible pattern-based system** that solves several critical issues:

1. **Three Opening Modes**: Control exactly when the composer auto-opens
   - `always`: Opens every time user visits the URL
   - `ifNoTopics`: Opens only if NO topics exist with these tags
   - `ifUserHasNoTopic`: Opens only if current user hasn't created a topic with these tags

2. **Draft Resurrection Prevention**: Active watcher prevents Discourse from resurrecting deleted drafts after template application

3. **Search Index Lag Handling**: 5-second cache prevents duplicate composer opens when Discourse's search index hasn't updated yet

4. **Unlimited URL Patterns**: No longer limited to 6 hardcoded templates

## Breaking Changes

### Settings Schema

The following settings are now **DEPRECATED** (but still work for backward compatibility):

- `auto_open_check_user_only` → Use `url_patterns` with mode instead
- `template_N_url_match` → Use `url_patterns` instead
- `template_N_use_for` → Use `url_patterns` timing field instead

### New Settings

**`url_patterns`** (list): Replaces the old per-template URL matching system.

Format: One pattern per line in the format:
```
urlPattern|templateId|mode|timing
```

**Fields:**
- `urlPattern`: URL substring to match (e.g., `/tags/intersection/intro/webdev`)
- `templateId`: Which template to use (`report`, `going`, `invite`, `wall`, `media`, `stories`)
- `mode`: When to auto-open composer
  - `always`: Always open (even if topics exist)
  - `ifNoTopics`: Open only if no topics exist with these tags
  - `ifUserHasNoTopic`: Open only if current user hasn't created a topic with these tags
- `timing`: When to apply the template
  - `first`: Only on first post (creating topic)
  - `replies`: Only on replies
  - `both`: Both first post and replies

## Migration Examples

### Old Configuration (v1.x)

```yaml
auto_open_check_user_only: true

template_1_enabled: true
template_1_id: "report"
template_1_url_match: "/tags/intersection/report"
template_1_use_for: "both"

template_2_enabled: true
template_2_id: "going"
template_2_url_match: "/tags/intersection/going"
template_2_use_for: "first_post"
```

### New Configuration (v2.0)

```yaml
url_patterns: |
  /tags/intersection/report|report|ifUserHasNoTopic|both
  /tags/intersection/going|going|ifUserHasNoTopic|first
```

**What changed:**
- `auto_open_check_user_only: true` → `mode=ifUserHasNoTopic`
- `template_1_url_match` → first part of pattern
- `template_1_id` → second part of pattern
- `use_for: "both"` → `both` (timing field)
- `use_for: "first_post"` → `first` (timing field)

### Migration Table

| Old Setting | New Pattern Part |
|-------------|------------------|
| `auto_open_check_user_only: true` | `mode=ifUserHasNoTopic` |
| `auto_open_check_user_only: false` | `mode=ifNoTopics` |
| `template_N_url_match: "/path"` | `/path` (first field) |
| `template_N_id: "templateName"` | `templateName` (second field) |
| `use_for: "both"` | `both` (fourth field) |
| `use_for: "first_post"` | `first` (fourth field) |
| `use_for: "all_replies"` | `replies` (fourth field) |

## Common Use Cases

### 1. Always Open Composer (e.g., for event sign-up pages)

```yaml
url_patterns: |
  /docuss/m_event_signup|going|always|both
```

**Effect:** Every time a user visits `/docuss/m_event_signup`, the composer opens with the "going" template, regardless of whether they've already posted.

### 2. One Response Per Person (e.g., introduction forms)

```yaml
url_patterns: |
  /tags/intersection/introductions/webdevs|going|ifUserHasNoTopic|first
```

**Effect:** Composer opens ONLY if the current user hasn't created a topic yet with these tags. Once they post, it won't auto-open again.

### 3. Community Wall (first topic creation only)

```yaml
url_patterns: |
  /tags/wall|wall|ifNoTopics|first
```

**Effect:** Composer opens ONLY if no one has created a topic yet. Once ANY user creates the first topic, auto-open stops for everyone.

### 4. Multiple Patterns for Same Template

```yaml
url_patterns: |
  /tags/intersection/report|report|ifUserHasNoTopic|both
  /tag/report|report|ifUserHasNoTopic|both
  /docuss/m_report_form|report|ifUserHasNoTopic|both
```

**Effect:** All three URLs trigger the same "report" template with the same behavior.

## Technical Improvements

### Draft Resurrection Prevention

**Old behavior (v1.x):**
- Used `setTimeout(500)` to block draft saves
- Unreliable - Discourse's auto-save could resurrect drafts

**New behavior (v2.0):**
- Active watcher polls every 50ms
- Detects when `draftKey` changes from `"new_topic"`
- Immediately clears resurrection attempts
- Stops watching when composer closes or user manually saves

### Search Index Lag Handling

**Problem:** Discourse's search index can lag by several seconds after topic creation. This caused:
- Composer reopening immediately after posting
- "Cannot find pathname" errors when navigating to newly created topics

**Solution:** 5-second topic creation cache
- Caches search results for `username:tags` or `any:tags` combinations
- Prevents duplicate searches within 5-second window
- Automatically expires old entries

**Cache Keys:**
- `ifUserHasNoTopic` mode: `"username:tag1+tag2"`
- `ifNoTopics` mode: `"any:tag1+tag2"`

## Testing Your Migration

1. **Test "always" mode:**
   - Visit URL matching pattern
   - Composer should open
   - Close composer and revisit URL
   - Composer should open again

2. **Test "ifUserHasNoTopic" mode:**
   - Visit URL (logged in)
   - Composer should open
   - Create a topic with template
   - Revisit same URL
   - Composer should NOT open

3. **Test "ifNoTopics" mode:**
   - Visit URL (no topics exist)
   - Composer should open
   - Have ANY user create a topic
   - Revisit URL
   - Composer should NOT open for anyone

4. **Test draft resurrection prevention:**
   - Let composer auto-open
   - Wait for template to apply
   - Check browser console (enable `debug_mode`)
   - Should see: "Starting draft resurrection watcher"
   - Should NOT see Discourse trying to save drafts

5. **Test cache:**
   - Create a topic via template
   - Immediately revisit the same URL
   - Composer should NOT reopen (even if search index hasn't updated)
   - Wait 5+ seconds, revisit
   - Cache expired, fresh search runs

## Rollback Plan

If you encounter issues, you can temporarily revert to old behavior:

1. Comment out or delete the `url_patterns` setting
2. Restore old `template_N_url_match` and `auto_open_check_user_only` settings
3. The component will fall back to v1.x behavior (but won't fix draft/cache issues)

## Support

If you encounter migration issues:

1. Enable `debug_mode: true` in settings
2. Open browser console (F12)
3. Look for log messages starting with:
   - `🚀 [Auto-Open Composer]` (auto-open logic)
   - `🎨 [URL Composer Templates]` (template application)
4. Check for pattern parsing errors or mode validation failures
5. Verify your pattern format: `urlPattern|templateId|mode|timing`

## Version History

- **v2.0.0**: Pattern-based system with three modes, draft watcher, search cache
- **v1.2.0**: Basic auto-open with `auto_open_check_user_only` boolean
- **v1.0.0**: Initial release with query parameter templates

