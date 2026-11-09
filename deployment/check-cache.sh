#!/bin/bash
# Exercise the real Docker/Caddy path, including the compatible React entry.
set -euo pipefail
shopt -s nocasematch
[[ $# == 1 ]] || exit 64
name=japanese-cache-check-$$
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
for entry in index.html legacy.html; do
    docker run -d --rm --name "$name" --network none --user 1000:1000 --read-only --cap-drop ALL \
        --security-opt no-new-privileges:true --tmpfs /tmp --tmpfs /config --tmpfs /data \
        -e CLIENT_ENTRY="$entry" "$1" >/dev/null
    ready=no
    for attempt in 1 2 3 4 5; do
        if docker exec "$name" wget -q -O /dev/null http://127.0.0.1:8080/; then ready=yes; break; fi
        sleep 1
    done
    [[ $ready == yes ]]
    for path in / /index.html /album.html /legacy.html /login /register /forgot-password /recover /invite /verify-email /confirm-email /admin; do
        headers=$(docker exec "$name" wget -S -O /dev/null "http://127.0.0.1:8080$path" 2>&1)
        [[ $headers == *'cache-control: no-store'* ]]
    done
    cleanup
done
echo 'Docker HTML cache policy passed for all entry routes in Canvas and React modes'
