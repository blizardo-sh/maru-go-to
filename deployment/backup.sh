#!/bin/bash
set -euo pipefail
umask 077
[[ $# == 1 && $1 =~ ^(backup|verify|status)$ ]] || exit 64
source /etc/japanese-learning/host.env
export RESTIC_REPOSITORY=sftp:vpnbackup@$BACKUP_HOST:/repo/japanese-learning
export RESTIC_PASSWORD_FILE=/etc/vpn-maintenance/restic-password
transport="ssh -p 5555 -i /etc/vpn-maintenance/backup-identity -o BatchMode=yes -o IdentitiesOnly=yes -o IPQoS=none -o ControlMaster=no -o ControlPath=none -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/vpn-maintenance/known_hosts -s vpnbackup@$BACKUP_HOST sftp"
restic() { /usr/bin/restic -o "sftp.command=$transport" "$@"; }
state=/var/lib/japanese-backup
mkdir -p "$state"
if [[ $1 == status ]]; then
    python3 - "$state/last-success" <<'PY'
import pathlib,sys,time
p=pathlib.Path(sys.argv[1])
age=time.time()-p.stat().st_mtime
print(f'Last verified offsite backup: {age/60:.1f} minutes ago')
assert age < 3600, 'Offsite backup is older than the one-hour recovery target'
PY
    exit
fi
exec 8>/run/lock/japanese-backup.lock
flock -w 600 8
cd /opt/japanese-learning
compose() { docker compose --env-file .env --env-file release.env -f compose.yaml "$@"; }
if [[ $1 == backup ]]; then
    stage=$state/snapshot
    mkdir -p "$stage"
    compose exec -T db pg_dump -U japanese_admin -d japanese_learning -Fc > "$stage/database.dump.partial"
    mv "$stage/database.dump.partial" "$stage/database.dump"
    tar -C / -czf "$stage/configuration.tar.gz" \
        opt/japanese-learning/.env opt/japanese-learning/release.env opt/japanese-learning/compose.yaml opt/japanese-learning/init-db.sh \
        etc/nginx root/.acme.sh root/cert etc/japanese-learning/host.env etc/systemd/system/japanese-backup.service etc/systemd/system/japanese-backup.timer \
        etc/systemd/system/japanese-backup-verify.service etc/systemd/system/japanese-backup-verify.timer \
        usr/local/sbin/japanese-release usr/local/sbin/japanese-backup usr/local/sbin/japanese-ssh
    restic backup --tag japanese "$stage"
    restic forget --tag japanese --keep-last 2 --keep-hourly 168 --keep-daily 30 --prune
    date -u +%FT%TZ > "$state/last-success"
    echo 'OFFSITE_BACKUP_OK'
else
    started=$SECONDS
    work=$(mktemp -d "$state/restore.XXXXXX")
    database=japanese_restore_$$
    created=no
    cleanup() {
        if [[ $created == yes ]]; then compose exec -T db dropdb -U japanese_admin "$database"; fi
        rm -rf "$work"
    }
    trap cleanup EXIT
    restic check --read-data
    restic restore latest --tag japanese --target "$work"
    dump=$work/var/lib/japanese-backup/snapshot/database.dump
    test -s "$dump"
    compose exec -T db createdb -U japanese_admin "$database"
    created=yes
    compose exec -T db pg_restore -U japanese_admin --exit-on-error --no-owner --no-acl -d "$database" < "$dump"
    test "$(compose exec -T db psql -U japanese_admin -d "$database" -Atc "select to_regclass('users') is not null and to_regclass('review_states') is not null and to_regclass('review_attempts') is not null")" = t
    compose exec -T db psql -U japanese_admin -d "$database" -c 'select (select count(*) from users) as users, (select count(*) from review_states) as review_states, (select count(*) from review_attempts) as review_attempts, (select count(*) from access_links) as access_links'
    date -u +%FT%TZ > "$state/last-restore"
    echo "OFFSITE_RESTORE_OK seconds=$((SECONDS-started))"
fi
