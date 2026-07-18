# Changelog

This file records notable user-facing, security, deployment, and behavior changes. Minor visual polish, wording changes, routine fixes, and internal refactors are intentionally omitted.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Expanded configurable Preview option applicability to any combination of services, service groups, and bookmarks, with bookmark fields and add-dialog defaults sourced from option-definition JSON.

## [1.3.0] - 2026-07-17

### Added

- Added configurable Preview option types, including service and service-group applicability, ordering, and safer updates to existing local definitions.
- Added controls for showing, hiding, and reordering YAML tabs, with persistent preferences.
- Added interactive Preview controls for adding, editing, removing, and reordering bookmark groups and bookmarks.

### Changed

- Reorganized Settings into accessible Appearance, Misc, and YAML tabs sections, with clearer controls for Auto Indent, Auto Refresh, and the interactive dashboard editor.
- Refined the editable dashboard, tab-management controls, and Preview editing layout for a more consistent and compact experience.

### Fixed

- Improved parser, directory, file-save, background-load, and Preview editing errors with actionable guidance.
- Prevented invalid or duplicate service-group mappings and improved validation when removing or changing Preview option types.

## [1.2.0] - 2026-07-15

### Added

- Added Preview editing for service groups, services, layout tabs, and ordered YAML option rows, with confirmations, movement controls, unsaved tracking, and Undo.
- Added editing support for Docker, Proxmox, and Kubernetes configuration files alongside the original four Homepage YAML files.
- Added persistent editor preferences and editable Preview option-type definitions.
- Added repository-managed sample YAML files, read-only sample mode for empty startup directories, and expanded seven-file navigation.
- Added source-aware Preview navigation, Homepage documentation access, Auto Refresh, and improved workspace icons and layout.

### Changed

- Reworked the editor toolbar, file actions, notifications, confirmation dialogs, navigation, and Preview into a more compact workspace UI.
- Improved dark/light theme styling, responsive behavior, accessibility labels, and handling of long URLs and text.
- Blocked ZIP downloads while unsaved changes are pending and added a save-or-discard prompt.

### Fixed

- Included the Preview transformation module in Docker images so containers start correctly.

## [1.1.0] - 2026-07-15

### Added

- Added a virtualized CodeMirror YAML editor with syntax highlighting, auto-indent, comment toggling, source-aware Homepage-style Preview, and ZIP downloads.
- Added directory autoloading and reload, inline save and validation results, unsaved-change warnings, configurable themes, and optional form authentication.
- Added integration tests and repository development guidance.

### Changed

- Improved save behavior to validate and write all modified YAML tabs atomically while preserving raw YAML comments and formatting.
- Improved startup loading, Preview rendering performance, static-asset caching, interface styling, and container dependency/ownership handling.

### Fixed

- Fixed Preview source navigation, stale startup YAML, Windows line endings in the container entrypoint, `.yml` filename preservation, and access to unsupported files or directories.

## [1.0.0] - 2026-07-05

### Added

- Initial Express-based Homepage YAML editor with Docker and Docker Compose deployment support.
- Added editing support for `services`, `settings`, `bookmarks`, and `widgets` YAML files.
