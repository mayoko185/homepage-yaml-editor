#!/bin/sh

set -e

PUID="${PUID:-1001}"
PGID="${PGID:-1001}"
APP_USER="homepage"
APP_GROUP="homepage"

mkdir -p /app/data /hp_config

EXISTING_GROUP="$(getent group "$PGID" | cut -d: -f1 || true)"
if [ -n "$EXISTING_GROUP" ]; then
    APP_GROUP="$EXISTING_GROUP"
elif ! getent group "$APP_GROUP" >/dev/null 2>&1; then
    addgroup -g "$PGID" -S "$APP_GROUP"
fi

EXISTING_USER="$(getent passwd "$PUID" | cut -d: -f1 || true)"
if [ -n "$EXISTING_USER" ]; then
    APP_USER="$EXISTING_USER"
elif ! getent passwd "$APP_USER" >/dev/null 2>&1; then
    adduser -S -D -H -u "$PUID" -G "$APP_GROUP" "$APP_USER"
fi

chown_if_needed() {
    target="$1"
    owner="$(stat -c '%u:%g' "$target" 2>/dev/null || true)"
    if [ "$owner" != "$PUID:$PGID" ]; then
        chown "$PUID:$PGID" "$target" || true
    fi
}

chown_if_needed /app/data
chown_if_needed /hp_config

for base_name in services settings bookmarks widgets docker proxmox kubernetes; do
    for extension in yaml yml; do
        config_file="/hp_config/${base_name}.${extension}"
        if [ -f "$config_file" ]; then
            chown_if_needed "$config_file"
        fi
    done
done

exec su-exec "$PUID:$PGID" node server.js
