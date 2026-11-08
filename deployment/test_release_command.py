"""Release phase regressions; real Compose/backup failure tests live in verification."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

REPO = Path(__file__).parents[1]
OLD = 'b' * 40
NEW = 'a' * 40

@unittest.skipIf(int(subprocess.check_output(['bash','-c','echo ${BASH_VERSINFO[0]}'])) < 4,
                 'The Linux release host requires Bash 4 or later')
class ReleaseCommandTests(unittest.TestCase):
    def run_release(self, failure='none'):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tools = root / 'tools'; tools.mkdir()
            old_env = 'API_IMAGE=old-api\nWEB_IMAGE=old-web\n'
            (root/'release.env').write_text(old_env)
            (root/'deployed-commit').write_text(OLD+'\n')
            (root/'.env').write_text('MIGRATION_DATABASE_URL=local-fixture-only\n')
            script=(REPO/'deployment/release.sh').read_text()
            for before,after in [('/opt/japanese-learning',directory),('/run/lock/japanese-deploy.lock',str(root/'lock')),('/run/japanese-',str(root/'japanese-')),('/usr/local/sbin/japanese-backup',str(tools/'backup'))]:script=script.replace(before,after)
            (root/'release.sh').write_text(script)
            shim='''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
root=Path(os.environ['FIXTURE']);name=Path(sys.argv[0]).name;args=sys.argv[1:];failure=os.environ['FAILURE']
with (root/'events').open('a') as f:f.write(json.dumps([name,args])+'\\n')
if name=='flock':sys.exit(0)
if name=='backup':
 n=len((root/'backups').read_text().splitlines()) if (root/'backups').exists() else 0
 if args==['backup']:
  with (root/'backups').open('a') as f:f.write(json.dumps((root/'release.env').read_text())+'\\n')
  if failure==('pre-backup' if n==0 else 'post-backup'):sys.exit(75)
 elif failure=='verify':sys.exit(76)
elif name=='curl':
 if failure=='readiness':sys.exit(78)
elif name=='systemctl':
 if failure=='timers':sys.exit(77)
elif name=='docker':
 if 'pull' in args and failure=='pull':sys.exit(72)
 if 'inspect' in args:
  if 'org.opencontainers.image.revision' in ' '.join(args):print('a'*40)
  elif 'RepoDigests' in ' '.join(args):print(args[-1].split(':')[0]+'@sha256:'+'a'*64)
  else:print('sha256:fixture')
 if 'compose' in args:
  if '-e' in args and 'bun' in args and failure=='compatibility':sys.exit(79)
  if 'src/server/migrate.ts' in args and failure=='migration':sys.exit(73)
  if 'up' in args and args[-2:]==['api','web'] and failure=='activation':sys.exit(74)
'''
            for name in ['docker','backup','curl','systemctl','flock']:
                file=tools/name;file.write_text(shim);file.chmod(0o755)
            result=subprocess.run(['bash',str(root/'release.sh'),NEW],input='fixture-token\n',text=True,capture_output=True,env={**os.environ,'PATH':str(tools)+':'+os.environ['PATH'],'FIXTURE':directory,'FAILURE':failure},timeout=15)
            return {'exit':result.returncode,'stderr':result.stderr,'release':(root/'release.env').read_text(),'commit':(root/'deployed-commit').read_text().strip(),'status':(root/'deployment-status').read_text() if (root/'deployment-status').exists() else result.stderr,'backups':(root/'backups').read_text().splitlines() if (root/'backups').exists() else [],'events':[json.loads(line) for line in (root/'events').read_text().splitlines()],'oldEnv':old_env}

    def test_failures_before_activation_leave_previous_configuration(self):
        for phase in ['pull','compatibility','pre-backup','migration']:
            with self.subTest(phase=phase):
                r=self.run_release(phase)
                self.assertNotEqual(r['exit'],0,r)
                self.assertEqual(r['release'],r['oldEnv'])
                self.assertEqual(r['commit'],OLD)
                self.assertFalse(any(name=='docker' and 'up' in args and args[-2:]==['api','web'] for name,args in r['events']))

    def test_failures_after_start_never_silently_downgrade_api(self):
        for phase in ['activation','readiness','post-backup','verify','timers']:
            with self.subTest(phase=phase):
                r=self.run_release(phase)
                self.assertNotEqual(r['exit'],0,r)
                self.assertIn('switched=yes',r['status'])
                self.assertNotEqual(r['release'],r['oldEnv'])
                self.assertEqual(sum(name=='docker' and 'up' in args and args[-2:]==['api','web'] for name,args in r['events']),1)
                self.assertEqual(r['commit'],OLD if phase in ['activation','readiness'] else NEW)

    def test_success_backs_up_matching_configuration_and_records_verified(self):
        r=self.run_release()
        self.assertEqual(r['exit'],0,r)
        self.assertEqual(json.loads(r['backups'][0]),r['oldEnv'])
        self.assertEqual(json.loads(r['backups'][1]),r['release'])
        self.assertEqual(r['commit'],NEW)
        self.assertEqual(r['status'],'VERIFIED '+NEW+'\n')

if __name__=='__main__':unittest.main()
