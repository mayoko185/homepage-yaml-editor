# Changelog

All notable changes to Homepage YAML Editor are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added cursor-aware toolbar navigation between matching Services groups and Settings layout sections.

### Changed

- Replaced the Auto Indent checkbox with a toolbar-style indentation icon and active state.
- Moved Save, Load, Reload, and Download into a right-aligned editor toolbar action group with icons.

## [1.1.0] - 2026-07-15

### Added

- Added a virtualized CodeMirror YAML editor with syntax highlighting, auto-indent, and comment toggling from the editor toolbar or with `Ctrl+/`.
- Added a lightweight Homepage-style preview with source navigation for services, groups, bookmarks, widgets, tabs, and layout providers.
- Added inline save results and human-readable YAML validation errors that navigate to the affected source line.
- Added directory autoloading, manual loading, and a Reload action for rereading the most recently loaded directory.
- Added ZIP downloads for all supported configurations.
- Added configurable dark or light startup themes through `DEFAULT_THEME`.
- Added optional form-based authentication through `REQUIRE_LOGIN_USER` and `REQUIRE_LOGIN_PASSWORD`, including an HTTP warning when login is enabled without HTTPS.
- Added warnings before leaving the page with unsaved changes.
- Added unsaved-file indicators to configuration tabs and the notification area.
- Added integration tests for configuration APIs, caching, and optional authentication.
- Added repository development guidance in `AGENTS.md`.

### Changed

- Save now validates and writes every modified YAML tab in one operation instead of saving only the active tab.
- Raw YAML text is preserved when loading and saving so comments and formatting are retained.
- Startup-directory requests reread files from disk, preventing stale YAML after a page refresh.
- Preview rendering is debounced, cached, delegated, and indexed linearly for better performance on larger configurations.
- Refined the header, notification area, controls, tabs, editor toolbar, floating navigation, scrollbars, and light/dark styling.
- Simplified the primary control labels to Save, Load, Reload, and Download.
- Versioned static assets now use longer cache lifetimes while HTML responses are revalidated.
- Container startup uses locked pnpm dependencies and limits ownership updates to required configuration paths and files.

### Fixed

- Fixed preview-to-source navigation selecting or highlighting the entire YAML document instead of only the target line.
- Fixed preview navigation after the editor was changed to viewport rendering.
- Fixed stale startup YAML remaining visible until Load was clicked manually.
- Fixed the container entrypoint failing to execute `start.sh` after Windows CRLF checkouts by normalizing line endings and preserving executable permissions.
- Fixed `.yml` files being renamed to `.yaml` when saved.
- Fixed startup and API access allowing unsupported filenames or unapproved configuration directories.

## [1.0.0] - 2026-07-05

### Added

- Initial Express-based Homepage YAML editor.
- Initial Docker and Docker Compose deployment support.
- Editing support for `services`, `settings`, `bookmarks`, and `widgets` YAML files.
