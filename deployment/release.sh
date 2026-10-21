#!/bin/bash
set -euo pipefail
umask 077
[[ $# == 1 && $1 =~ ^[0-9a-f]{40}$ ]] || exit 64
exec 9>/run/lock/japanese-deploy.lock
flock -w 600 9
cd /opt/japanese-learning
sha=$1
registry=ghcr.io/blizardo-sh/maru-go-to
auth=$(mktemp -d /run/japanese-registry.XXXXXX)
candidate=$(mktemp /run/japanese-release.XXXXXX)
trap 'rm -rf "$auth"; rm -f "$candidate"' EXIT
IFS= read -r token
[[ -n $token ]] || exit 65
printf '%s' "$token" | docker --config "$auth" login ghcr.io -u blizardo-sh --password-stdin >/dev/null
unset token
for target in api web; do
    image=$registry-$target:$sha
    docker --config "$auth" pull "$image"
    [[ $(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image") == "$sha" ]]
    digest=$(docker image inspect --format '{{index .RepoDigests 0}}' "$image")
    printf '%s_IMAGE=%s\n' "${target^^}" "$digest" >> "$candidate"
done
rm -rf "$auth"
compose() { docker compose --env-file .env --env-file release.env -f compose.yaml "$@"; }
previous=no
if [[ -f release.env && -f deployed-commit ]]; then
    cp release.env previous.env
    previous=yes
else
    rm -f previous.env
fi
cp "$candidate" release.env
rollback() {
    status=$?
    trap - ERR
    if [[ $previous == yes ]]; then
        cp previous.env release.env
        compose up -d --wait --wait-timeout 120 api web || true
    fi
    echo 'Release failed. Database migrations are not automatically reversed.' >&2
    exit "$status"
}
trap rollback ERR
compose up -d --wait --wait-timeout 120 db
/usr/local/sbin/japanese-backup backup
DATABASE_URL=$(sed -n 's/^MIGRATION_DATABASE_URL=//p' .env) compose run --rm --no-deps -e DATABASE_URL api bun src/server/migrate.ts
compose up -d --wait --wait-timeout 120 api web
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8081/ready
/usr/local/sbin/japanese-backup backup
/usr/local/sbin/japanese-backup verify
systemctl enable --now japanese-backup.timer japanese-backup-verify.timer
printf '%s\n' "$sha" > deployed-commit
trap - ERR
# Retain the running and previous release without pruning images belonging to other apps.
for target in api web; do
    field=${target^^}_IMAGE
    current=$(docker image inspect --format '{{.Id}}' "$(sed -n "s/^$field=//p" release.env)")
    prior=''
    if [[ -f previous.env ]]; then prior=$(docker image inspect --format '{{.Id}}' "$(sed -n "s/^$field=//p" previous.env)"); fi
    while read -r id tag; do
        if [[ $id != "$current" && $id != "$prior" && $tag =~ ^[0-9a-f]{40}$ ]]; then
            docker image rm "$registry-$target:$tag" || true
        fi
    done < <(docker image ls --no-trunc --format '{{.ID}} {{.Tag}}' "$registry-$target")
done
docker image prune -f --filter 'label=org.opencontainers.image.source=https://github.com/blizardo-sh/maru-go-to' || true
echo "DEPLOYED $sha"
