"""Exercise publication ordering without Docker, sudo, production paths or a database."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

REPO = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location('content_package', REPO / 'scripts/content-package.py')
package = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(package)


class ContentCommandTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.published = self.root / 'published'
        self.source = self.root / 'source'
        (self.source / 'audio').mkdir(parents=True)
        (self.source / 'audio/test.m4a').write_bytes(b'fixture')
        bundle = self.root / 'bundle.json'
        bundle.write_text(json.dumps({'formatVersion': 1, 'course': {}, 'assets': [
            {'path': '/audio/test.m4a', 'sha256': hashlib.sha256(b'fixture').hexdigest(), 'bytes': 7}]}))
        archive = self.root / 'content.tar'
        package.pack(bundle, self.source, archive)
        self.archive = archive.read_bytes()
        self.digest = hashlib.sha256(self.archive).hexdigest()
        script = (REPO / 'deployment/content.sh').read_text()
        for before, after in [('/opt/japanese-learning', str(self.root)),
                              ('/run/lock/japanese-deploy.lock', str(self.root / 'lock')),
                              ('/var/tmp/japanese-content.XXXXXX', str(self.root / 'stage.XXXXXX')),
                              ('/var/lib/japanese-content', str(self.published)),
                              ('/usr/local/sbin/japanese-content-package.py', str(REPO / 'scripts/content-package.py'))]:
            script = script.replace(before, after)
        self.script = self.root / 'content.sh'
        self.script.write_text(script)
        tools = self.root / 'tools'
        tools.mkdir()
        for name, value in {
            'flock': '#!/bin/sh\nexit 0\n',
            'timeout': '#!/bin/sh\nshift\nexec "$@"\n',
            'docker': '''#!/usr/bin/env python3
import json,os,sys
args=sys.argv[1:]
with open(os.environ['COMMAND_LOG'],'a') as out:out.write(json.dumps(args)+'\\n')
if 'verify-publication' in args and os.environ.get('FAIL_VERIFY')=='1':sys.exit(65)
'''} .items():
            path = tools / name
            path.write_text(value)
            path.chmod(0o755)
        self.log = self.root / 'commands.jsonl'
        self.env = {**os.environ, 'PATH': str(tools) + ':' + os.environ['PATH'], 'COMMAND_LOG': str(self.log)}

    def run_publish(self):
        result = subprocess.run(['bash', str(self.script), 'publish', self.digest], input=self.archive,
                                env=self.env, capture_output=True, timeout=10)
        commands = [json.loads(line) for line in self.log.read_text().splitlines()]
        return result, commands

    def test_staged_verify_precedes_immutable_install_and_activation(self):
        result, commands = self.run_publish()
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual((self.published / 'media/audio/test.m4a').read_bytes(), b'fixture')
        self.assertTrue((self.published / ('bundles/' + self.digest + '.json')).is_file())
        verify = next(i for i, command in enumerate(commands) if 'verify-publication' in command)
        publish = next(i for i, command in enumerate(commands) if 'publish' in command)
        self.assertLess(verify, publish)
        self.assertIn('CONTENT_MEDIA_ROOT=/package/media', commands[verify])
        self.assertIn('/package/bundle.json', commands[publish])

    def test_failed_validation_never_installs_or_activates(self):
        self.env['FAIL_VERIFY'] = '1'
        result, commands = self.run_publish()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.published.exists())
        self.assertFalse(any('publish' in command for command in commands))

    def test_wrong_transport_digest_never_reaches_api(self):
        self.digest = 'a' * 64
        result, commands = self.run_publish()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.published.exists())
        self.assertFalse(any('verify-publication' in command or 'publish' in command for command in commands))

    def test_immutable_conflict_never_activates(self):
        target = self.published / 'media/audio/test.m4a'
        target.parent.mkdir(parents=True)
        target.write_bytes(b'previous bytes')
        result, commands = self.run_publish()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(target.read_bytes(), b'previous bytes')
        self.assertFalse(any('publish' in command for command in commands))


if __name__ == '__main__':
    unittest.main()
