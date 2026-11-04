"""Restore the approved snapshot into a loopback-only, disposable local cluster."""
from pathlib import Path
import hashlib
import json
import os
import secrets
import subprocess

ROOT = Path(__file__).resolve().parent
PRIVATE = ROOT / '.local/rehearsal-20261028'
BIN = ROOT / '.local/tools/postgres18/bin'
SNAPSHOT = 'e285b7cd65c2457759c3eb0473673699a59d76d9d57632f070478c42c5e52cc4'
SOURCE = 'b378244d9fc40a357dc8fafd931400e42b7e1752'
os.umask(0o077)
assert hashlib.sha256((PRIVATE / 'database.dump').read_bytes()).hexdigest() == '5d59ab76af6ee5a0caa46844a3bf25e4382109ea1d60ed7bd5a561e0ec3d0359'
assert not (PRIVATE / 'runtime.json').exists(), 'Already restored; use the existing clone. Never reset it implicitly.'
password = secrets.token_urlsafe(32)
pw = PRIVATE / 'postgres-password'
pw.write_text(password)
data = PRIVATE / 'postgres'
def run(name, *args):
    subprocess.run([str(BIN / name), *map(str, args)], check=True, stdout=subprocess.DEVNULL)
run('initdb', '-D', data, '-U', 'pixi_owner', '--pwfile', pw, '--auth-local=trust', '--auth-host=scram-sha-256', '--encoding=UTF8', '--locale=C')
with (data / 'postgresql.conf').open('a') as f:
    f.write("\nlisten_addresses='127.0.0.1'\nport=55440\nunix_socket_directories=''\n")
run('pg_ctl', '-D', data, '-l', PRIVATE / 'postgres.log', '-w', 'start')
os.environ['PGPASSWORD'] = password
common = ['-h', '127.0.0.1', '-p', '55440', '-U', 'pixi_owner']
run('createdb', *common, 'japanese_pixi_baseline')
run('pg_restore', *common, '--exit-on-error', '--no-owner', '--no-privileges', '-d', 'japanese_pixi_baseline', PRIVATE / 'database.dump')
run('createdb', *common, '-T', 'japanese_pixi_baseline', 'japanese_pixi_work')
run('psql', *common, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'ALTER DATABASE japanese_pixi_baseline SET default_transaction_read_only = on')
(PRIVATE / 'runtime.json').write_text(json.dumps({
    'snapshot': SNAPSHOT, 'source': SOURCE,
    'baseline': f'postgres://pixi_owner:{password}@127.0.0.1:55440/japanese_pixi_baseline',
    'database': f'postgres://pixi_owner:{password}@127.0.0.1:55440/japanese_pixi_work',
    'secret': secrets.token_urlsafe(48), 'origin': 'http://localhost:5191'
}, indent=2) + '\n')
print('Restored baseline and independent working clone; baseline default is read-only. PostgreSQL binds loopback:55440.')
