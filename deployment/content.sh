#!/bin/bash
# Called only by the restricted SSH dispatcher; never accepts a path or shell command.
set -euo pipefail
umask 077
[[ $# == 2 && $1 =~ ^(publish|rollback)$ && $2 =~ ^[0-9a-f]{64}$ ]] || exit 64
exec 9>/run/lock/japanese-deploy.lock
flock -w 60 9
cd /opt/japanese-learning
container=japanese-content-$$
stage=''
bundle_temporary=''
cleanup() {
    timeout 10 docker rm -f "$container" >/dev/null 2>&1 || true
    if [[ -n $stage ]]; then rm -rf "$stage"; fi
    if [[ -n $bundle_temporary ]]; then rm -f "$bundle_temporary"; fi
}
trap cleanup EXIT
if [[ $1 == rollback ]]; then
    timeout 90 docker compose --env-file .env --env-file release.env -f compose.yaml run --rm -T --no-deps --name "$container" api bun scripts/content.ts rollback "$2"
    exit
fi
stage=$(mktemp -d /var/tmp/japanese-content.XXXXXX)
timeout 180 python3 /usr/local/sbin/japanese-content-package.py receive "$2" "$stage"
# The archive contains public content only; the non-root read-only API must read its bind mount.
chmod -R go=rX "$stage/package"
timeout 90 docker compose --env-file .env --env-file release.env -f compose.yaml run --rm -T --no-deps --name "$container" \
    -v "$stage/package:/package:ro" -e CONTENT_MEDIA_ROOT=/package/media api bun scripts/content.ts verify-media /package/bundle.json
timeout 90 python3 /usr/local/sbin/japanese-content-package.py install "$stage/package" /var/lib/japanese-content/media
install -d -m 755 /var/lib/japanese-content/bundles
saved_bundle=/var/lib/japanese-content/bundles/$2.json
if [[ -e $saved_bundle ]]; then
    cmp -s "$stage/package/bundle.json" "$saved_bundle"
else
    bundle_temporary=/var/lib/japanese-content/bundles/.$2-$$.partial
    install -m 644 "$stage/package/bundle.json" "$bundle_temporary"
    mv "$bundle_temporary" "$saved_bundle"
    bundle_temporary=''
fi
timeout 90 docker compose --env-file .env --env-file release.env -f compose.yaml run --rm -T --no-deps --name "$container" \
    -v "$stage/package:/package:ro" api bun scripts/content.ts publish /package/bundle.json
