# Tab Search Plus

A Firefox extension that recreates Chrome's Tab Search popup: search open tabs, jump to a result, close an open tab from the list, restore recently closed tabs or windows, and see tab group color/name indicators.

## Features

- Chrome-style popup with dark-mode support.
- Search by tab title, URL, and visible tab group name.
- Open-tab rows sorted by active tab and recent use.
- Switch to tabs across normal Firefox windows.
- Close open tabs from the right-side close button.
- Restore recently closed tabs and closed windows through Firefox session restore.
- Show tab group indicators using Firefox's `tabGroups` API when available.
- Customizable shortcut from the options page. Default is `Cmd + Ctrl + A` on macOS and `Ctrl + Alt + A` on Windows/Linux.

## Local Testing

1. Open Firefox and go to `about:debugging`.
2. Select **This Firefox**.
3. Choose **Load Temporary Add-on...**.
4. Select this repository's `manifest.json`.
5. Click the toolbar button or press the configured shortcut.

Temporary add-ons are removed when Firefox restarts.

## Shortcut

The shortcut is implemented with Firefox's `_execute_browser_action` command, so it opens the exact same popup as the toolbar button. You can change it from the extension options page or Firefox's built-in extension shortcut manager.

## Notes

Chrome's desktop help documents Tab Search as a tab-strip button and shortcut that lets users find open tabs, open a selected result, and close tabs from the result list. Firefox exposes the matching extension capabilities through the `tabs`, `sessions`, `commands`, and `tabGroups` WebExtension APIs.
