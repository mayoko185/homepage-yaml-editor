# Homepage YAML Editor

A small browser-based editor for [Homepage](https://gethomepage.dev/) YAML configuration files. Designed to run alongside Homepage via docker, loads the standard Homepage config files, provides a YAML editor with syntax highlighting, and shows a lightweight dashboard preview.

## Features

- Edit `services`, `settings`, `bookmarks`, `widgets`, `docker`, `proxmox`, and `kubernetes` YAML files.
- Auto-load a mounted Homepage config directory at startup.
- Save raw YAML text back to disk without reformatting comments or spacing.
- Download supported config files as a zip archive.
- Syntax-highlight YAML while preserving exact saved text.
- Toggle comments for the current or selected YAML lines from the editor toolbar or with `Ctrl+/`.
- Jump between matching service groups and Settings layout sections based on the editor cursor position.
- Show save results and validation errors inline without interrupting editing with browser popups.
- Preview Homepage tabs, service groups, collapsed groups, cards, bookmarks, widgets, and dashboard-icons.
- Supports `.yaml` and `.yml` filenames.

## Supported Files

The editor intentionally limits reads and writes to these Homepage config files:

- `services.yaml` or `services.yml`
- `settings.yaml` or `settings.yml`
- `bookmarks.yaml` or `bookmarks.yml`
- `widgets.yaml` or `widgets.yml`

Open the editor at:

```text
http://localhost:8081
```

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8081` | Port the Express server listens on inside the container/process. |
| `PUID` | `1001` | User ID used by `start.sh` inside the Docker container. |
| `PGID` | `1001` | Group ID used by `start.sh` inside the Docker container. |
| `DATA_DIR` | `/hp_config` | Directory used by the built-in `/api/config/*` data-file endpoints. |
| `AUTOLOAD_DIR` | unset | Preferred startup autoload directory. Set this to the mounted Homepage config path you want loaded automatically. |
| `ALLOWED_CONFIG_DIRS` | unset | Optional comma-separated list of additional server-side directories that can be loaded from or saved to. `/hp_config`, `DATA_DIR`, and `AUTOLOAD_DIR` are always allowed. |
| `DEFAULT_THEME` | `dark` | Initial interface theme. Set to `light` for light mode; missing or invalid values use dark mode. |
| `REQUIRE_LOGIN_USER` | unset | Username for optional form-based login. Login is enabled only when this and `REQUIRE_LOGIN_PASSWORD` are both set. |
| `REQUIRE_LOGIN_PASSWORD` | unset | Password for optional form-based login. Login is enabled only when this and `REQUIRE_LOGIN_USER` are both set. |

## Optional Login

Set both login variables to protect the editor and its APIs:

```yaml
environment:
  - REQUIRE_LOGIN_USER=admin
  - REQUIRE_LOGIN_PASSWORD=replace-with-a-strong-password
```

If neither variable is set, the editor remains open as before. If only one is set, the container exits with a configuration error so an incomplete login setup cannot accidentally expose the editor.

Successful sign-in creates an HTTP-only, `SameSite=Strict` session that lasts for 12 hours or until the container restarts. Use HTTPS through a reverse proxy when exposing the editor outside a trusted network.

When login is enabled over plain HTTP, the login page displays a warning but still allows sign-in. When using Nginx for HTTPS termination, forward the original protocol so session cookies receive the `Secure` attribute:

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
```

## Startup Autoload Behavior

On startup, the app chooses an autoload directory in this order:

1. `AUTOLOAD_DIR`
2. `/hp_config`, only if that directory exists

If a startup directory contains at least one supported YAML file, the editor loads files from that directory and replaces the toolbar's `Reset` action with `Reload`. An empty startup directory remains in read-only sample mode instead of being reported as loaded.

## Default Samples

The built-in sample content is loaded from the repository's `examples` directory. Replace any of the seven supported YAML files there to change what a fresh editor session and the `Reset` action use. Rebuild the Docker image after changing these files so the updated examples are copied into the container. Sample mode is read-only: edits remain in the browser, and Save stays disabled until a configuration directory is loaded.

## Saving Behavior

When a directory is autoloaded or loaded manually, `Save Configuration` writes the active tab back to that same directory.

Loaded directories must be `/hp_config`, `DATA_DIR`, `AUTOLOAD_DIR`, or a path listed in `ALLOWED_CONFIG_DIRS`. This keeps LAN clients from reading or writing arbitrary server paths while preserving the normal mounted-config workflow.

If the loaded file was `.yml`, saves keep using `.yml`. If it was `.yaml`, saves keep using `.yaml`.

If no directory is loaded, the editor uses read-only examples and Save is disabled. Load a configuration directory before saving changes.

`Download All` creates a zip archive containing all seven supported YAML files from the editor.

## Icons

The preview supports Homepage-style `icon` values in both `services.yaml` service entries and `settings.yaml` layout groups.

- Full URLs are used as-is.
- Names like `docker.png` are resolved through `homarr-labs/dashboard-icons` using jsDelivr.
- Extensionless names like `mylar` are treated as `mylar.png`.

## Notes

- Directory paths are server-side paths, not paths from the browser's local filesystem.
- Server-side directory loading and saving is limited to allowed config paths.
- The app validates YAML before saving.
- The preview is intentionally lightweight and may not implement every Homepage feature exactly.
- The YAML editor uses viewport rendering, so large configuration files do not create one DOM node per line.

## Development

Node.js 20 or newer and pnpm 11.7.0 are supported.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm dev
```
