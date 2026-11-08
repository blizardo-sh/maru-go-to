#!/bin/bash
set -Eeuo pipefail
umask 077
[[ $# == 1 && $1 =~ ^[0-9a-f]{40}$ ]] || exit 64
exec 9>/run/lock/japanese-deploy.lock
flock -w 600 9
cd /opt/japanese-learning
sha=$1
registry=ghcr.io/blizardo-sh/maru-go-to
phase=download
switched=no
failed() {
    status=$1
    trap - ERR
    printf 'FAILED phase=%s candidate=%s switched=%s\n' "$phase" "$sha" "$switched" > deployment-status
    if [[ $switched == yes ]]; then
        echo "Release failed during $phase. Candidate configuration retained; do not downgrade the API without checking current data compatibility." >&2
    else
        echo "Release failed during $phase. Existing application images were not switched." >&2
    fi
    echo 'Database migrations and learner data are never automatically reversed.' >&2
    exit "$status"
}
trap 'failed "$?"' ERR
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
release_env=release.env
compose() { docker compose --env-file .env --env-file "$release_env" -f compose.yaml "$@"; }
# A first installation has no previous application configuration to preserve.
if [[ ! -f release.env ]]; then cp "$candidate" release.env; fi
phase=database
compose up -d --wait --wait-timeout 120 db
phase=publication-compatibility
# Inactive publications still own pinned answers; checking only the active one is insufficient.
release_env=$candidate compose run --rm -T --no-deps api bun -e '
import {connectDatabase} from "./src/server/db";
import {getPublication} from "./src/server/publications";
const d=connectDatabase(process.env.DATABASE_URL);
try {
    const [table]=await d.sql`select to_regclass(${"public.content_publications"}) as name`;
    if(table.name) for(const row of await d.sql`select id from content_publications`) await getPublication(d,row.id);
} finally {await d.sql.close();}
'
phase=backup-before
/usr/local/sbin/japanese-backup backup
phase=migration
release_env=$candidate DATABASE_URL=$(sed -n 's/^MIGRATION_DATABASE_URL=//p' .env) compose run --rm -T --no-deps -e DATABASE_URL api bun src/server/migrate.ts
if ! cmp -s "$candidate" release.env; then cp release.env previous.env; fi
# From the first start attempt the candidate may accept writes, even before /ready succeeds.
phase=activation
switched=yes
cp "$candidate" release.env
compose up -d --wait --wait-timeout 120 api web
phase=readiness
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8081/ready
printf '%s\n' "$sha" > deployed-commit
printf 'RUNNING %s\n' "$sha" > deployment-status
phase=backup-after
/usr/local/sbin/japanese-backup backup
phase=verify-after
/usr/local/sbin/japanese-backup verify
phase=timers
systemctl enable --now japanese-backup.timer japanese-backup-verify.timer
printf 'VERIFIED %s\n' "$sha" > deployment-status
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
