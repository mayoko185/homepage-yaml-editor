# Changelog

This file records notable user-facing, security, deployment, and behavior changes. Meaningful UI, layout, and workflow changes are summarized by their final outcome; intermediate design iterations, minor visual polish, wording changes, routine fixes, and internal refactors are intentionally omitted.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added a bundled `app-settings.default.json` that seeds editor setting defaults (theme, page title, tab order, auto-indent, etc.), so defaults can be changed by editing JSON instead of server code. `DEFAULT_THEME` still overrides the bundled `theme` default.
- Added a configurable Live Homepage URL in the Appearance settings tab that, when set, surfaces a header button linking to the live dashboard.

### Changed

- Repositioned the interactive-editor tab hover toolbar to appear below the tab (or above the tab when a second row of tabs sits below it), removed the "Jump to tab in settings.yaml" action, folded "+ Add tab" into the toolbar with right-of-anchor insertion for newly created service groups, promoted the add-tab dialog to a centered dimmed modal, and removed orphaned CSS/JS from the prior Manage-tabs modal.
- Redesigned the preview tab strip: tabs now support drag-and-drop reordering with a visible drop line, a hover toolbar with rename, remove, and jump-to-source, and an inline "+ Add tab" control that drops into rename mode for the new tab. Removed the separate "Manage tabs" modal.
- Extended the Interactive Editor to nested service groups: hover toolbars now support editing, moving, and deleting nested groups and the services inside them, each nested group has its own Add service button, and preview-to-source navigation jumps to the correct nested YAML line.
- Added a Convert into a nested group control in the service group edit dialog that wraps a group's direct services into numbered nested sub-groups, with an adjustable count that auto-names sub-groups 1..N. A convert-back control flattens nested sub-groups into direct services with a collapse warning.

## [1.3.1] - 2026-07-18

### Added

- Added an `pnpm audit --audit-level=high` script (`pnpm run audit`) and documented the dependency-audit expectation for lockfile and dependency changes.
- Added a persistent custom page title setting that updates both the application heading and browser tab.
- Added inline renaming for dashboard layout tabs in the tab manager.
- Added a persistent security warning when editor authentication is disabled and optional Playwright browser coverage.

### Changed

- Updated the Docker Compose example and installation guide to run the official Homepage container alongside the editor using a shared configuration directory.
- Expanded configurable Preview option applicability to any combination of services, service groups, and bookmarks, with bookmark fields and add-dialog defaults sourced from option-definition JSON.
- Refined the Interactive Editor with draggable dashboard and option-row surfaces, cross-group service and bookmark moves, service-to-group and group-to-tab reassignment from tabbed edit dialogs, compact contextual controls, and keyboard-accessible move buttons.
- Hardened configuration persistence with atomic replacement, disk-change conflict detection, bounded authentication state, self-hosted browser dependencies, and a stricter content security policy.
- Aligned container user defaults and deployment guidance on UID/GID `1000` while preserving network-accessible Compose ports.

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
