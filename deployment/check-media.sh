#!/bin/bash
# Linux-only, disposable container: no published ports, production network or database.
set -euo pipefail
[[ $# == 1 ]] || exit 64
work=$(mktemp -d)
name=japanese-media-check-$$
cleanup() {
    docker rm -f "$name" >/dev/null 2>&1 || true
    rm -rf "$work"
}
trap cleanup EXIT
chmod 755 "$work"
mkdir -m 755 "$work/audio"
printf 'published fixture' > "$work/audio/content-check.m4a"
chmod 644 "$work/audio/content-check.m4a"
docker run -d --rm --name "$name" --network none --user 1000:1000 --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true --tmpfs /tmp --tmpfs /config --tmpfs /data \
    -v "$work:/content:ro" "$1" >/dev/null
ready=no
for attempt in 1 2 3 4 5; do
    if docker exec "$name" wget -q -O /dev/null http://127.0.0.1:8080/audio/content-check.m4a; then ready=yes; break; fi
    sleep 1
done
[[ $ready == yes ]]
[[ $(docker exec "$name" wget -q -O - http://127.0.0.1:8080/audio/content-check.m4a) == 'published fixture' ]]
# Existing image media remain available, and a missing media URL never falls back to index.html.
docker exec "$name" wget -q -O /dev/null http://127.0.0.1:8080/audio/manifest.json
if docker exec "$name" wget -q -O /dev/null http://127.0.0.1:8080/audio/content-check-missing.m4a; then exit 1; fi
if docker exec "$name" sh -c 'printf bad >> /content/audio/content-check.m4a'; then exit 1; fi
echo 'Read-only publication media, legacy fallback and missing-media boundary passed'
