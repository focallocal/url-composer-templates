<!-- cSpell:disable -->

# URL Composer Templates

A Discourse theme component that pre-fills the composer with template text based on URL parameters. Designed to work seamlessly with Docuss to provide context-specific templates for different types of interactions.

## Features

- **URL Parameter Support**: Automatically detects \?composer_template=X\ in URLs and applies the corresponding template
- **Multiple Template Types**: Configure up to 6 different templates for different purposes (report, going, invite, custom templates)
- **Auto-Open Composer**: Optionally auto-opens the composer when visiting a Docuss link based on URL flags
- **Flexible Application**: Templates can apply to first post only, all replies, or both
- **Session Persistence**: Uses sessionStorage to maintain template selection across page navigations
- **Debug Mode**: Enable detailed console logging to troubleshoot template application
- **Standalone URL Matching**: Watch for any substring in the Discourse URL (e.g., \/tags/intersection/introductions\) and trigger templates without Docuss

## Installation

1. **Install the theme component on Discourse:**
   - Go to Admin  Customize  Themes
   - Click "Install"  "From a Git repository"
   - Enter: \https://github.com/focallocal/url-composer-templates\
   - Add the component to your active theme

2. **No plugin rebuild required!** The \composer_template\ parameter support already exists in dcs-discourse-plugin and dcs-client.

3. **Deploy your React app (fl-maps)** with the updated DCSLink components that pass the \composerTemplate\ and \has_topics\ props.

4. **Configure templates** in the component settings (Admin  Customize  Themes  your theme  url-composer-templates  Settings).

## Configuration

### Standalone vs Docuss Modes

This component was built to complement [Docuss](https://github.com/sylque/docuss), which automatically appends \?composer_template=<id>\ to map URLs. However, it can operate completely on its own: simply tell it which URLs to watch and it will open the composer with the matching templateeven if Docuss is not installed.

- **Docuss-assisted**: leave the defaults in place and Docuss will keep sending \?composer_template=invite\ (or your chosen value) as people click embedded buttons.
- **Standalone**: set \	emplate_param_key\ and/or the per-template \	emplate_x_url_match\ strings so the component sniffs Discourse URLs directly (e.g., \/tag/introductions\, \/tags/intersection/introductions/webdevs\).

Because the detection is handled entirely on the Discourse side, any system that modifies URLs (links, buttons, bookmarks, manual typing) can drive templates.

### Template Settings

Each template has three configuration options:

#### Template 1 (Report)
- **template_1_id**: \
eport\ - The URL parameter value to trigger this template
- **template_1_text**: The text to pre-fill in the composer
- **template_1_use_for**: \irst_post\ - Apply only when creating new topics

#### Template 2 (Going)
- **template_2_id**: \going\ - For "I'm going" type interactions
- **template_2_text**: Pre-filled text for going confirmations
- **template_2_use_for**: \ll_replies\ - Apply to all replies (not first posts)

#### Template 3 (Invite)
- **template_3_id**: \invite\ - For invitation interactions
- **template_3_text**: Pre-filled text for invitations
- **template_3_use_for**: \ll_replies\ - Apply to all replies

#### Templates 4-6 (Custom)
- Disabled by default
- Can be enabled and customized for specific use cases
- Configure ID, text, and application scope as needed

### Auto-Open Settings

- **enable_auto_open_composer**: \	rue\ - When enabled, automatically opens the composer based on the template mode.
- **template_param_key**: Defaults to \composer_template\. Change this if you want to read a different query parameter, or leave it empty to disable query-parameter detection entirely.
- **Template \url_match\ fields**: Every template now includes a \	emplate_X_url_match\ setting. Provide any substring (path, tag intersection, hash, etc.) and the component will trigger that template whenever the current Discourse URL contains the substring. Leave blank to disable substring matching for that template.

#### Auto-Open Modes

Each template has a \mode\ setting that controls when the composer auto-opens:

1. **Always**: The composer will ALWAYS open when this template is triggered.
2. **IfNoTopics**: The composer will open ONLY if the URL does **not** contain \&has_topics=true\.
   - If the URL has \&has_topics=true\, the component assumes topics exist and does **not** auto-open.
   - If the URL is missing \has_topics\ or it is set to \alse\, the component assumes no topics exist and **will** auto-open.

This logic relies on the upstream application (e.g., \l-maps\) to check for topic existence and pass the correct flag. This eliminates race conditions and API lag on the Discourse side.

### Debug Mode

- **debug_mode**: \alse\ - Enable to see detailed console logs with emoji prefixes:
  -  Template application logs
  -  Auto-open composer logs

## Docuss Integration

### Automatic Integration

The url-composer-templates component is designed to work automatically with Docuss. When you have both:
- This component installed on your Discourse instance
- The updated Docuss client and plugin (with composer_template support)

Templates will be automatically applied based on:
1. **Interact Mode**: 
   - \DISCUSS\ mode  Uses triggerId hints (going, invite) or defaults to \
eport\
   - \COMMENT\ mode  Uses \
eport\ template

### Custom Templates via HTML Attributes

For more precise control, you can specify templates directly in your HTML using the \data-dcs-composer-template\ attribute:

\\\html
<!-- Example: Report button -->
<div class="dcs-trigger" 
     data-dcs-trigger-id="issue-report"
     data-dcs-interact-mode="DISCUSS"
     data-dcs-composer-template="report">
  Report an Issue
</div>

<!-- Example: Going button -->
<div class="dcs-trigger" 
     data-dcs-trigger-id="event-rsvp"
     data-dcs-interact-mode="DISCUSS"
     data-dcs-composer-template="going">
  I'm Going!
</div>

<!-- Example: Invite button -->
<div class="dcs-trigger" 
     data-dcs-trigger-id="invite-friends"
     data-dcs-interact-mode="DISCUSS"
     data-dcs-composer-template="invite">
  Invite Friends
</div>

<!-- Example: Custom template -->
<div class="dcs-trigger" 
     data-dcs-trigger-id="feedback"
     data-dcs-interact-mode="DISCUSS"
     data-dcs-composer-template="custom1">
  Give Feedback
</div>
\\\

### Template ID Matching

The component matches template IDs from the URL parameter with the configured template IDs:

| URL Parameter | Template Setting | Default Purpose |
|--------------|------------------|-----------------|
| \?composer_template=report\ | \	emplate_1_id\ | Bug reports, issues |
| \?composer_template=going\ | \	emplate_2_id\ | Event RSVPs |
| \?composer_template=invite\ | \	emplate_3_id\ | Invitations |
| \?composer_template=custom1\ | \	emplate_4_id\ | Custom use |
| \?composer_template=custom2\ | \	emplate_5_id\ | Custom use |
| \?composer_template=custom3\ | \	emplate_6_id\ | Custom use |

When using standalone substring matching, you can skip the query parameter entirely. For example:

| URL contains | Set \	emplate_X_url_match\ to | Result |
|---------------|-------------------------------|--------|
| \/tag/introductions\ | \/tag/introductions\ | Use the Introductions template whenever someone is in that tag |
| \/tags/intersection/introductions/webdevs\ | \/tags/intersection/introductions/webdevs\ | Pre-fill the composer for a specific tag intersection |
| \/c/projects/new\ | \/c/projects/new\ | Turn any category URL into a guided template |

## How It Works

### Template Application Flow

1. **URL Detection**: When a user navigates to a URL with \?composer_template=X\ (or any configured substring), the component stores the template ID in sessionStorage
2. **Composer Interception**: When the composer opens, the component checks for a stored template ID
3. **Template Matching**: Finds the matching template based on ID
4. **Scope Validation**: Checks if the template should apply (first post, reply, or both)
5. **Text Insertion**: Pre-fills the composer with the template text
6. **Cleanup**: Marks the template as applied to prevent re-application

### Auto-Open Flow

1. **Parameter Detection**: Checks if URL contains \?composer_template=X\ and auto-open is enabled
2. **Mode Check**: Checks the configured mode for the template (\lways\ or \ifNoTopics\)
3. **Topic Check (ifNoTopics)**: Checks if the URL contains \&has_topics=true\
4. **Composer Opening**: If conditions are met, automatically opens the composer
5. **Template Application**: The template is then applied via the normal flow above

## Example Use Cases

### Event Website
\\\yaml
# settings.yml
template_2_id: "going"
template_2_text: "I'm planning to attend! \n\nLooking forward to seeing everyone there."
template_2_use_for: "all_replies"

template_3_id: "invite"
template_3_text: "I'd like to invite friends to this event.\n\nWho I'm inviting:\n- \n\nWhy they should come:\n"
template_3_use_for: "first_post"
\\\

### Issue Tracking
\\\yaml
template_1_id: "bug"
template_1_text: "**Bug Description:**\n\n**Steps to Reproduce:**\n1. \n2. \n3. \n\n**Expected Behavior:**\n\n**Actual Behavior:**\n"
template_1_use_for: "first_post"

template_4_enabled: true
template_4_id: "feature"
template_4_text: "**Feature Request:**\n\n**Use Case:**\n\n**Proposed Solution:**\n"
template_4_use_for: "first_post"
\\\

### Community Engagement
\\\yaml
template_1_id: "question"
template_1_text: "**My Question:**\n\n**What I've Tried:**\n\n**Additional Context:**\n"
template_1_use_for: "first_post"

template_2_id: "answer"
template_2_text: "Here's what worked for me:\n\n**Solution:**\n\n**Why it works:**\n"
template_2_use_for: "all_replies"
\\\

## Troubleshooting

### Templates Not Applying

1. **Check URL Parameter**: Ensure the URL contains \?composer_template=X\ where X matches a template ID
2. **Enable Debug Mode**: Turn on \debug_mode\ in settings to see console logs
3. **Verify Template Scope**: Check if \use_for\ setting matches your action (creating topic vs replying)
4. **Clear SessionStorage**: Open browser console and run: \sessionStorage.clear()\

### Auto-Open Not Working

1. **Check Setting**: Ensure \enable_auto_open_composer\ is set to \	rue\
2. **Verify URL**: Auto-open only works when URL contains \?composer_template=X\
3. **Check has_topics**: If using \ifNoTopics\ mode, ensure the URL does NOT contain \&has_topics=true\
4. **Enable Debug Mode**: Look for  emoji logs in the console

### HTTP 409 "Draft is being edited in another window"

This only appeared for Docuss-triggered composers and was traced to two behaviors:

- The old "draft resurrection" watcher in `url-composer-templates.js` forcibly set every composer back to the global `"new_topic"` draft key whenever a template finished applying.
- Auto-open also launched new Docuss composers with the same `"new_topic"` key, so Discourse tried to reuse an existing draft sequence that already had different text. The very first `/drafts.json` POST then failed with HTTP 409 because the optimistic-lock `draft_sequence` no longer lined up.

**Fix (already in main):**

1. Removed the watcher and any code that mutates `composerModel.draftKey` after the composer opens (`javascripts/discourse/api-initializers/url-composer-templates.js`).
2. When Docuss auto-opens the composer we now provide the template body/title immediately *and* generate a unique draft key per session (`docuss-<template>-<timestamp>` in `z-auto-open-composer.js`). The first autosave therefore matches the payload the server expects, so no 409 occurs.

If this behavior ever regresses, search the repo for `draftKey` mutations or `"new_topic"` overrides and remove them. Repeating the two steps above will restore the healthy flow.

### Wrong Template Applying

1. **Check Template IDs**: Ensure your URL parameter matches the template ID exactly (case-sensitive)
2. **Verify Priority**: If multiple templates could match, the first matching template is used
3. **Clear Session**: SessionStorage might contain old values: \sessionStorage.clear()\

### Docuss Integration Issues

1. **Update Docuss**: Ensure you have the latest versions of:
   - \dcs-client\ (with composerTemplate support in HtmlBased.js)
   - \dcs-discourse-plugin\ (with URL parameter generation in DcsIFrame.js.es6)
2. **Check HTML Attributes**: Verify \data-dcs-composer-template\ is set correctly on triggers
3. **Inspect Network**: Check browser DevTools Network tab to see if URL parameters are being added

## Version History

### v3.0.0 (Simplified Logic)
- Removed complex API calls and caching for topic existence
- Added support for \has_topics\ URL parameter
- Simplified \ifNoTopics\ mode to rely on upstream flags
- Improved reliability and reduced race conditions

### v1.0.0 (Initial)
- Initial release
- Support for 6 configurable templates
- URL parameter-based template selection
- Auto-open composer for Docuss links
- SessionStorage persistence
- Debug mode for troubleshooting

## Contributing

Found a bug or have a feature request? Please open an issue on the [GitHub repository](https://github.com/focallocal/url-composer-templates).

## License

This component is open source and available under the MIT License.

## Credits

Developed by [Andy@Focallocal](https://github.com/focallocal) for use with [Docuss](https://github.com/sylque/docuss) - a system for embedding Discourse discussions into any website.

<!-- cSpell:enable -->
