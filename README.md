# Homepage YAML Editor

A small browser-based editor for [Homepage](https://gethomepage.dev/) YAML configuration files. Designed to run alongside Homepage via docker, loads the standard Homepage config files, provides a YAML editor with syntax highlighting, and shows a lightweight dashboard preview.

## Features

- Edit `services`, `settings`, `bookmarks`, and `widgets` YAML files.
- Auto-load a mounted Homepage config directory at startup.
- Save raw YAML text back to disk without reformatting comments or spacing.
- Download supported config files as a zip archive.
- Syntax-highlight YAML while preserving exact saved text.
- Toggle comments for the current or selected YAML lines from the editor toolbar or with `Ctrl+/`.
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

## Startup Autoload Behavior

On startup, the app chooses an autoload directory in this order:

1. `AUTOLOAD_DIR`
2. `/hp_config`, only if that directory exists

If a startup directory is autoloaded successfully, the editor loads files from that directory and hides the `Reset to Sample` button. This avoids accidentally replacing real mounted config content with sample YAML.

## Saving Behavior

When a directory is autoloaded or loaded manually, `Save Configuration` writes the active tab back to that same directory.

Loaded directories must be `/hp_config`, `DATA_DIR`, `AUTOLOAD_DIR`, or a path listed in `ALLOWED_CONFIG_DIRS`. This keeps LAN clients from reading or writing arbitrary server paths while preserving the normal mounted-config workflow.

If the loaded file was `.yml`, saves keep using `.yml`. If it was `.yaml`, saves keep using `.yaml`.

If no directory is loaded, saves use the data-file endpoint and write to `DATA_DIR`.

`Download All` creates a zip archive containing the current `services`, `settings`, `bookmarks`, and `widgets` YAML content from the editor.

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
