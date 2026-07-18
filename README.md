# Homepage YAML Editor

Homepage YAML Editor is a browser-based editor for [Homepage](https://gethomepage.dev/) configuration files. I find it a pain to edit yaml files especially long ones so I designed this to run side by side with homepage. 

Disclaimer this project uses AI to write code and troubleshoot issues.

## Screenshots

### YAML editor

![YAML editor](screenshots/test-yaml-editor.jpg)

Edit raw YAML with CodeMirror, file tabs, validation, and a live Homepage-style preview.

### Interactive editor

![Interactive editor](screenshots/interactive-editor.jpg)

Add, edit, reorder, and remove dashboard groups, services, and bookmarks from the preview.

## Highlights

- Supports `services`, `settings`, `bookmarks`, `widgets`, `docker`, `proxmox`, and `kubernetes` YAML files.
- Preserves the original YAML text, comments, and formatting when files are loaded and saved.
- Provides syntax highlighting, line numbers, auto-indent, comment toggling, validation, and preview-to-source navigation.
- Renders groups, service cards, bookmarks, widgets, icons, layouts, and common Homepage options in the preview.
- Includes an Interactive Editor for adding, editing, moving, drag-reordering, and deleting supported dashboard items; tabbed layouts include direct service-to-group and service-group-to-tab reassignment controls.
- Keeps changes pending until Save, with undo support and a ZIP download for all loaded files.
- Remembers theme, a custom page and browser-tab title, visible tabs, editor preferences, and custom option types.
- Lets custom option types target any combination of services, service groups, bookmarks, and service widgets, with configurable defaults for new items.
- Can be protected with an optional username and password.

## Installation

### Docker Compose

The recommended setup uses the current [docker-compose.yml](https://github.com/mayoko185/homepage-yaml-editor/blob/main/docker-compose.yml). It runs the official Homepage image and Homepage YAML Editor together:

```sh
git clone https://github.com/mayoko185/homepage-yaml-editor.git
cd homepage-yaml-editor
# Edit the config volume path and HOMEPAGE_ALLOWED_HOSTS in docker-compose.yml if needed
docker compose up -d
```

Open Homepage at `http://server-ip:3000` and the editor at `http://server-ip:8081` (or use `localhost` when browsing from the Docker host).

Both containers mount the same `/opt/stacks/homepage/config` host directory. Homepage sees it at `/app/config`, while the editor sees it at `/hp_config`. Change both volume entries if your Homepage configuration is stored elsewhere, keeping the host-side path identical:

```yaml
services:
  homepage:
    volumes:
      - /path/to/homepage/config:/app/config

  homepage-editor:
    environment:
      - AUTOLOAD_DIR=/hp_config
    volumes:
      - /path/to/homepage/config:/hp_config
```

Use matching `PUID` and `PGID` values so both containers can access the configuration files. Set `HOMEPAGE_ALLOWED_HOSTS` to the hostname or IP address used to open Homepage when accessing it through anything other than localhost. The commented Docker socket mount is optional; configure the required socket permissions before enabling it, or use a Docker socket proxy. Editor-specific settings remain separate in `./data`.

After saving in the editor, Homepage reads the updated files from the shared directory. Some `settings.yaml` changes require using Homepage's refresh control before they appear.

### Docker image

Use the published image directly when you do not need to build locally:

```sh
docker run -d \
  --name homepage-yaml-editor \
  --restart unless-stopped \
  -p 127.0.0.1:8081:8081 \
  -e AUTOLOAD_DIR=/hp_config \
  -v /path/to/homepage/config:/hp_config \
  -v "$PWD/data:/app/data" \
  docker.io/mayoko185/homepage-yaml-editor:latest
```

### Local development

Requires Node.js 20 or newer and pnpm 11.7.0:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The development server listens on <http://localhost:8081>. Set `DATA_DIR`, `AUTOLOAD_DIR`, or `ALLOWED_CONFIG_DIRS` to point it at your Homepage configuration directory.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATA_DIR` | `/hp_config` | Default directory for Homepage YAML files. |
| `AUTOLOAD_DIR` | unset | Directory to load automatically at startup. |
| `ALLOWED_CONFIG_DIRS` | unset | Comma-separated additional directories allowed for loading and saving. |
| `APP_DATA_DIR` | `/app/data` | Persistent editor settings and option definitions. |
| `DEFAULT_THEME` | `dark` | Initial theme; use `light` for the light theme. |
| `REQUIRE_LOGIN_USER` | unset | Optional login username. Must be paired with `REQUIRE_LOGIN_PASSWORD`. |
| `REQUIRE_LOGIN_PASSWORD` | unset | Optional login password. |
| `PUID` / `PGID` | `1000` | Container user and group IDs used by the startup script. |

To enable login in Compose, uncomment and change both `REQUIRE_LOGIN_USER` and `REQUIRE_LOGIN_PASSWORD`.

## Usage notes

- If no configuration directory is available, the app opens bundled sample YAML files in read-only mode.
- Saving validates YAML first and only writes the supported Homepage filenames.
- Loaded directories must be `/hp_config`, `DATA_DIR`, `AUTOLOAD_DIR`, or a path listed in `ALLOWED_CONFIG_DIRS`.
- The Interactive Editor currently focuses on service and bookmark YAML. Raw YAML editing remains available for every supported file.

## License

See the repository for license information.
