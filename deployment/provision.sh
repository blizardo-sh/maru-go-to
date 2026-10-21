#!/bin/bash
# One-time host provisioning; run from this directory as root after reviewing the VPN listener.
set -euo pipefail
umask 077
[[ $EUID == 0 && $# == 2 && -f $1 && -f $2 ]]
source "$2"
[[ $DOMAIN =~ ^[a-z0-9.-]+$ && $PUBLIC_IPV4 =~ ^[0-9.]+$ && $BACKUP_HOST =~ ^[0-9.]+$ ]]
export JAPANESE_PUBLIC_IPV4=$PUBLIC_IPV4
[[ ! -e /opt/japanese-learning/provisioned ]]
test "$(uname -m)" = x86_64
test "$(df --output=avail -k / | tail -1)" -gt 2097152
test -f /etc/nginx/modules-enabled/50-mod-stream.conf
test -f /root/cert/"$DOMAIN"/privkey.pem
install -d -m 700 /opt/japanese-learning /var/lib/japanese-provision /var/lib/japanese-backup
install -d -m 700 /etc/japanese-learning
install -m 600 "$2" /etc/japanese-learning/host.env
install -m 600 compose.yaml /opt/japanese-learning/compose.yaml
install -m 755 init-db.sh /opt/japanese-learning/init-db.sh
install -m 755 release.sh /usr/local/sbin/japanese-release
install -m 755 backup.sh /usr/local/sbin/japanese-backup
install -m 755 ssh-command.sh /usr/local/sbin/japanese-ssh
install -m 644 japanese-backup.service japanese-backup.timer japanese-backup-verify.service japanese-backup-verify.timer /etc/systemd/system/
DOMAIN="$DOMAIN" python3 - <<'PY'
from pathlib import Path
import secrets,os
p=Path('/opt/japanese-learning/.env')
assert not p.exists(), 'Existing configuration requires a separate migration plan'
admin=secrets.token_hex(32);app=secrets.token_hex(32)
p.write_text(f'POSTGRES_PASSWORD={admin}\nAPP_DATABASE_PASSWORD={app}\nDATABASE_URL=postgres://japanese:{app}@db:5432/japanese_learning\nMIGRATION_DATABASE_URL=postgres://japanese_admin:{admin}@db:5432/japanese_learning\nBETTER_AUTH_SECRET={secrets.token_urlsafe(48)}\nAPP_URL=https://{os.environ["DOMAIN"]}\n')
p.chmod(0o600)
PY
id japanese-deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash japanese-deploy
chown root:root /home/japanese-deploy
chmod 755 /home/japanese-deploy
install -d -m 755 -o root -g root /home/japanese-deploy/.ssh
printf 'restrict,command="/usr/local/sbin/japanese-ssh" %s\n' "$(cat "$1")" > /home/japanese-deploy/.ssh/authorized_keys
chmod 644 /home/japanese-deploy/.ssh/authorized_keys
printf 'japanese-deploy ALL=(root) NOPASSWD: /usr/local/sbin/japanese-release *\n' > /etc/sudoers.d/japanese-deploy
chmod 440 /etc/sudoers.d/japanese-deploy
visudo -cf /etc/sudoers.d/japanese-deploy
systemctl daemon-reload
transport="ssh -p 5555 -i /etc/vpn-maintenance/backup-identity -o BatchMode=yes -o IdentitiesOnly=yes -o IPQoS=none -o ControlMaster=no -o ControlPath=none -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/vpn-maintenance/known_hosts -s vpnbackup@$BACKUP_HOST sftp"
RESTIC_REPOSITORY=sftp:vpnbackup@$BACKUP_HOST:/repo/japanese-learning RESTIC_PASSWORD_FILE=/etc/vpn-maintenance/restic-password restic -o "sftp.command=$transport" init

# Preserve a consistent panel snapshot and an automatic rollback before changing listeners.
tar -C / -czf /var/lib/japanese-provision/nginx-before.tar.gz etc/nginx
cp /root/.acme.sh/"$DOMAIN"_ecc/"$DOMAIN".conf /var/lib/japanese-provision/acme-before.conf
python3 - <<'PY'
import sqlite3,json
from pathlib import Path
c=sqlite3.connect('/etc/x-ui/x-ui.db')
row=c.execute('select listen,port,stream_settings from inbounds where id=1').fetchone()
assert row and row[1]==443 and row[0] in ['', '0.0.0.0'], 'Unexpected VPN listener'
s=json.loads(row[2]);assert s['security']=='reality'
Path('/var/lib/japanese-provision/inbound-before.json').write_text(json.dumps(row))
target=sqlite3.connect('/var/lib/japanese-provision/x-ui-before.db');c.backup(target);target.close();c.close()
PY
cat > /var/lib/japanese-provision/rollback.sh <<'SH'
#!/bin/bash
set -euo pipefail
systemctl stop nginx
rm -f /etc/nginx/sites-enabled/japanese-learning /etc/nginx/sites-available/japanese-learning /etc/nginx/streams-enabled/japanese-learning.conf
tar -C / -xzf /var/lib/japanese-provision/nginx-before.tar.gz
source /etc/japanese-learning/host.env
cp /var/lib/japanese-provision/acme-before.conf /root/.acme.sh/"$DOMAIN"_ecc/"$DOMAIN".conf
python3 - <<'PY'
import sqlite3,json
from pathlib import Path
listen,port,stream=json.loads(Path('/var/lib/japanese-provision/inbound-before.json').read_text())
c=sqlite3.connect('/etc/x-ui/x-ui.db');c.execute('update inbounds set listen=?,port=?,stream_settings=? where id=1',(listen,port,stream));c.commit();c.close()
PY
systemctl restart x-ui
nginx -t
systemctl start nginx
echo NETWORK_ROLLBACK_COMPLETED
SH
chmod 700 /var/lib/japanese-provision/rollback.sh
systemd-run --unit=japanese-network-rollback --on-active=3min /var/lib/japanese-provision/rollback.sh
install -d -m 755 /etc/nginx/streams-enabled
sed -e "s/__DOMAIN__/$DOMAIN/g" nginx-http.conf > /etc/nginx/sites-available/japanese-learning
chmod 644 /etc/nginx/sites-available/japanese-learning
ln -s /etc/nginx/sites-available/japanese-learning /etc/nginx/sites-enabled/japanese-learning
sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__PUBLIC_IPV4__/$PUBLIC_IPV4/g" nginx-stream.conf > /etc/nginx/streams-enabled/japanese-learning.conf
chmod 644 /etc/nginx/streams-enabled/japanese-learning.conf
install -d -m 755 /var/lib/japanese-acme/.well-known/acme-challenge
DOMAIN="$DOMAIN" python3 - <<'PY'
from pathlib import Path
import os,re
d=os.environ['DOMAIN'];p=Path('/root/.acme.sh')/(d+'_ecc')/(d+'.conf')
s=p.read_text();s,count=re.subn(r'^Le_Webroot=.*$',"Le_Webroot='/var/lib/japanese-acme'",s,flags=re.M)
assert count==1;p.write_text(s)
PY
printf '\ninclude /etc/nginx/streams-enabled/*.conf;\n' >> /etc/nginx/nginx.conf
nginx -t
python3 - <<'PY'
import sqlite3,json
c=sqlite3.connect('/etc/x-ui/x-ui.db')
stream=json.loads(c.execute('select stream_settings from inbounds where id=1').fetchone()[0])
stream.setdefault('sockopt',{})['acceptProxyProtocol']=True
c.execute('update inbounds set listen=?,stream_settings=? where id=1',('127.0.0.1',json.dumps(stream)));c.commit();c.close()
PY
systemctl restart x-ui
systemctl reload nginx
bash ./verify-vpn.sh
challenge=$(cat /proc/sys/kernel/random/uuid)
printf '%s' "$challenge" > /var/lib/japanese-acme/.well-known/acme-challenge/deployment-check
chmod 644 /var/lib/japanese-acme/.well-known/acme-challenge/deployment-check
test "$(curl --fail --silent --show-error --max-time 15 "http://$DOMAIN/.well-known/acme-challenge/deployment-check")" = "$challenge"
rm /var/lib/japanese-acme/.well-known/acme-challenge/deployment-check
curl --silent --show-error --max-time 15 "https://$DOMAIN/" -o /dev/null
curl --fail --silent --show-error --max-time 15 "https://$DOMAIN:8443/api/health"
systemctl stop japanese-network-rollback.timer
touch /opt/japanese-learning/provisioned
echo HOST_PROVISIONED_VPN_AND_OPENGYM_VERIFIED
