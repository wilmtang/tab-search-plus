# Change Log
All notable changes to Chrome Tab Search will be documented in this file.

## [1.1.0]
### Added
- Add Chrome-style ranked search with title, hostname, and tab group highlighting.
- Add an Audio & Video section for audible and muted open tabs.
- Add macOS `Ctrl+N` and `Ctrl+P` keyboard aliases for result navigation.

### Changed
- Sort open tabs by most-recent use while moving the active tab in the focused window to the bottom.
- Flatten recently closed windows into individual tab rows, filter duplicates, and limit the default Recently Closed view to 8 items.
- Update mock mode to cover media tabs, search ranking, highlighting, closed-window flattening, and duplicate filtering.

## [1.0.0]
### Added
- Add Chrome-style tab search for Firefox with open-tab search, tab switching, and tab closing.
- Add recently closed tab and window restore through Firefox session restore.
- Add tab group color and name indicators when Firefox exposes tab group data.
- Add dark-mode support and configurable keyboard shortcut support.
- Add Firefox Add-ons publishing metadata and GitHub Actions release workflow.
- Rename the extension and repository identity to Chrome Tab Search.
