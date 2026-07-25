# AGENTS.md

## Scope

These instructions apply to the entire repository.

Working Directory Rule: When invoking bash or any shell tool, always set workdir to the absolute project path G:\code\homepage yaml editor\. Never prefix it with :, \\, or any other character, and never rely on relative paths for destructive operations.


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

- `server/index.js`: Express server entry point, middleware stack, static/vendor asset serving, and runtime-config generation.
- `server/routes/index.js`: Mounts all route handlers (auth, config, settings, startup).
- `server/routes/auth.js`: Login/logout routes and `authMiddleware`.
- `server/routes/config.js`: Examples, YAML transform, directory load/save routes.
- `server/routes/settings.js`: App-settings and option-types GET/PUT routes.
- `server/routes/startup.js`: Startup directory route.
- `server/lib/config-files.js`: File/directory validation helpers (17 functions).
- `server/lib/option-types.js`: Option-type definition management (9 functions).
- `server/lib/app-settings.js`: Editor settings management (8 functions).
- `server/auth/state.js`: Session and login-attempt map management with bounded-size eviction and expiry pruning.
- `server/yaml/transform.js`: In-memory Preview edit operations for service and Settings YAML documents.
- `server/yaml/index.js`: Re-export shim for `transform.js`.
- `defaults/option-types.default.json`: Bundled JSON defaults for Preview option types.
- `defaults/app-settings.default.json`: Bundled JSON defaults for editor settings (theme, page title, tab order, auto-indent, etc.).
- `public/index.html`: Page markup and external asset loading.
- `public/js/app.js`: ESM entry point — bootstrap/coordination layer (7 functions + event binding).
- `public/js/constants.js`: App constants (tab names, sample configs, option type choices).
- `public/js/state.js`: Single authoritative state owner with getters/setters.
- `public/js/api.js`: API wrappers and ZIP/download utilities.
- `public/js/editor.js`: CodeMirror wrapper functions.
- `public/js/ui.js`: DOM helpers, settings/theme/modals UI.
- `public/js/preview.js`: YAML operations, preview rendering, preview edit dialog, drag-and-drop.
- `public/js/vendor/chunk-tree.js`: ESM re-export of the UMD ChunkTree global.
- `public/chunk-tree.js`: Comment-preserving YAML chunk-tree parser/serializer (UMD/IIFE global, loaded via `<script>` before modules).
- `public/styles.css`: Application and CodeMirror styling (dark + light theme via `.light-mode` class).
- `public/login.html`: Login page markup.
- `public/js/login.js`: Login page client logic (error display, HTTP warning).
- `public/theme-bootstrap.js`: Applies the light-mode class before page render to avoid flash.
- `tests/server.test.js`: Server/API integration tests using Node's built-in test runner.
- `tests/yaml-transform.test.js`: YAML Preview transformation and comment-preservation tests.
- `tests/auth-state.test.js`: Auth state eviction and expiry tests.
- `tests/chunk-tree.test.js`: Chunk-tree parser/serializer tests (runs in Node via global jsyaml shim).
- `tests/browser/editor.spec.js`: Playwright browser tests.
- `tests/browser/global-setup.js`: Playwright global setup (temp dir, server start).
- `playwright.config.js`: Playwright configuration (Chromium, port 4173, temp config dir).
- `start.sh`: Container user/group setup and application startup.
- `Dockerfile`: Production container definition (node:24-alpine, pnpm, su-exec).
- `docker-compose.yml`: Example deployment configuration (Homepage + editor side-by-side).
- `.gitattributes`: LF normalization for `.sh` and `Dockerfile`.
- `.gitignore`: Ignores `node_modules/`, `.pnpm-store/`, logs, test artifacts, and runtime data files.
- `.git/hooks/pre-commit`: Enforces cache-version bumps for `styles.css` and `public/js/*.js` in HTML files.

Vendor assets (CodeMirror CSS/JS, js-yaml) are served from `node_modules` via `require.resolve()` mappings in `server/index.js`, not from a `public/vendor/` directory. The `runtime-config.js` endpoint is generated dynamically by the server.

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
node --check server/index.js
node --check server/routes/index.js
node --check server/lib/config-files.js
node --check public/js/app.js
node --check public/js/preview.js
node --check public/js/ui.js
node --check public/js/api.js
node --check public/js/state.js
node --check public/js/editor.js
node --check public/js/constants.js
node --check public/chunk-tree.js
```

Browser tests (requires Playwright Chromium):

```sh
pnpm exec playwright install chromium
pnpm test:browser
```

Check for whitespace issues before committing:

```sh
git diff --check
```

## Implementation Guidelines

- **CRITICAL ROLE**: Act as an equal, critical programming partner. If an instruction or request is ambiguous, flawed, or violates the architectural principles of this Express app, do not write or apply code immediately. Explicitly challenge the assumption, surface the design flaws, and propose a clean alternative architecture first.
- Preserve raw YAML text when loading and saving so comments and formatting are not lost.
- Validate YAML before writing any configuration file.
- Only allow the supported configuration filenames and directories approved by `HOMEPAGE_CONFIGS`.
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
