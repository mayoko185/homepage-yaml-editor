# AGENTS.md

## Scope

These instructions apply to the entire repository.

## Project Overview

Homepage YAML Editor is a small Express application for editing the supported Homepage configuration files:

- `services.yaml` / `services.yml`
- `settings.yaml` / `settings.yml`
- `bookmarks.yaml` / `bookmarks.yml`
- `widgets.yaml` / `widgets.yml`
- `docker.yaml` / `docker.yml`
- `proxmox.yaml` / `proxmox.yml`
- `kubernetes.yaml` / `kubernetes.yml`

The server reads and writes configuration files from explicitly allowed server-side directories. The browser provides a CodeMirror YAML editor and a lightweight Homepage-style preview.

## Repository Layout

- `server.js`: Express server, configuration-directory validation, YAML validation, and file APIs.
- `yaml-transform.js`: In-memory Preview edit operations for service and Settings YAML documents.
- `option-types.default.json`: Bundled JSON defaults for Preview option types, loaded by `server.js`.
- `app-settings.default.json`: Bundled JSON defaults for editor settings (theme, page title, tab order, auto-indent, etc.), loaded by `server.js`. `DEFAULT_THEME` still overrides the bundled `theme` default.
- `public/index.html`: Page markup and external asset loading.
- `public/app.js`: Editor state, save/load behavior, ZIP generation, preview rendering, and preview-to-source navigation.
- `public/styles.css`: Application and CodeMirror styling.
- `tests/server.test.js`: Server/API integration tests using Node's built-in test runner.
- `tests/yaml-transform.test.js`: YAML Preview transformation and comment-preservation tests.
- `start.sh`: Container user/group setup and application startup.
- `Dockerfile`: Production container definition.
- `docker-compose.yml`: Example deployment configuration.

## Development Commands

Use Node.js 20 or newer and pnpm 11.7.0.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm audit --audit-level=high
pnpm dev
```

Run syntax checks when changing JavaScript:

```sh
node --check server.js
node --check public/app.js
```

## Implementation Guidelines

- **CRITICAL ROLE**: Act as an equal, critical programming partner. If an instruction or request is ambiguous, flawed, or violates the architectural principles of this Express app, do not write or apply code immediately. Explicitly challenge the assumption, surface the design flaws, and propose a clean alternative architecture first.
- Preserve raw YAML text when loading and saving so comments and formatting are not lost.
- Validate YAML before writing any configuration file.
- Only allow the supported configuration filenames and directories approved by `DATA_DIR`, `AUTOLOAD_DIR`, `ALLOWED_CONFIG_DIRS`, or `/hp_config`.
- Keep filesystem work asynchronous. Avoid synchronous filesystem calls in request handlers.
- Reuse `loadDirectoryContents` and other shared helpers instead of duplicating directory traversal logic.
- Await startup initialization before starting the HTTP listener.
- Do not restore removed or unused API routes without a concrete caller and tests.

## Frontend Performance Guidelines

- Keep CodeMirror viewport rendering enabled; do not expand the editor to the full YAML document height.
- Do not rebuild the preview directly on every keystroke. Preserve debouncing and parsed-YAML caching.
- Do not attach an event listener to every generated preview item. Use delegated events on the preview container.
- Keep preview indexing linear. Use occurrence counters rather than repeated `findIndex`, `slice`, or prefix scans inside render loops.
- Put user-visible application notices and status messages in the notification area, not inside content panels; keep validation messages inside the dialog that needs the correction.
- Preview-to-source navigation must place the cursor on and temporarily highlight only the target line. It must not select the complete document or flash the entire editor.
- When changing cacheable CSS or JavaScript, increment the corresponding version query in `public/index.html` (and `public/login.html` for styles). A pre-commit hook (`.git/hooks/pre-commit`) blocks commits that stage these assets without a matching version-query increment.
- Keep HTML responses revalidated while allowing versioned CSS, JavaScript, and icon assets to use longer cache lifetimes.

## Testing Expectations

- Run `pnpm test` after server, API, caching, or file-handling changes.
- Run `pnpm audit --audit-level=high` (or `pnpm run audit`) after dependency or lockfile changes; resolve high or critical advisories before merging.
- Add or update tests for new API behavior, validation rules, or response headers.
- For editor or preview changes, verify in a real browser that:
  - YAML editing updates the preview.
  - Tabs retain their unsaved content.
  - Preview items navigate to the correct source line.
  - No browser console errors are introduced.
- Run `git diff --check` before handing off changes.

## Post-Change Checklist Report

After every code change (edits, writes, file creation), the agent must output an
explicit checklist report before closing. Each item from [Testing Expectations](#testing-expectations)
must be marked with one of:

- ✅ — completed and passed
- ⚠️ — requires manual verification by a human (explain why)
- N/A — not applicable to this change

The report format:

```
## Post-Change Checklist

| Item | Status |
|---|---|
| `pnpm test` | ✅ / ⚠️ / N/A |
| `pnpm audit` | ✅ / ⚠️ / N/A |
| Tests added/updated | ✅ / ⚠️ / N/A |
| Browser: preview updates | ✅ / ⚠️ / N/A |
| Browser: tabs retain content | ✅ / ⚠️ / N/A |
| Browser: source navigation | ✅ / ⚠️ / N/A |
| Browser: no console errors | ✅ / ⚠️ / N/A |
| `git diff --check` | ✅ / ⚠️ / N/A |
| Cache version bump | ✅ / ⚠️ / N/A |
```

The work is not finished until every item is explicitly marked. An item marked
⚠️ must include a brief reason (e.g., "requires a live browser").

## Docker and Shell Requirements

- `start.sh` must use LF line endings. The Docker build also normalizes the script as protection against Windows CRLF checkouts.
- Preserve executable permissions for `start.sh` in the container.
- Avoid recursive ownership changes across mounted configuration trees. Only adjust the required directories and supported files.
- Keep dependency installation locked and reproducible with `pnpm-lock.yaml` and `--frozen-lockfile`.

## Change Discipline

- Preserve unrelated user changes in the working tree.
- Prefer focused changes over broad rewrites.
- Update `CHANGELOG.md` for releases, security or deployment changes, and meaningful user-visible feature, behavior, workflow, layout, or UI changes.
- Keep changelog entries concise and grouped by the final user-visible outcome. When a feature or design changes several times before it is finished, add one general entry rather than a play-by-play of each iteration.
- Do not add separate entries for minor visual polish, wording or icon tweaks, routine bug fixes, internal refactors, or details already covered by a broader entry.
- Update `README.md` when commands, environment variables, deployment behavior, or user-visible functionality changes.
- When bumping the version in `package.json`, also update the footer version in `public/index.html`. A unit test in `tests/server.test.js` enforces this and will fail if the two drift apart.
- Do not commit generated dependency directories such as `node_modules` or `.pnpm-store`.
