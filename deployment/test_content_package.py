import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('content_package', Path(__file__).parents[1] / 'scripts/content-package.py')
package = importlib.util.module_from_spec(SPEC)
if SPEC.loader:
    SPEC.loader.exec_module(package)


class ContentPackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.media = self.root / 'source'
        (self.media / 'audio').mkdir(parents=True)
        (self.media / 'audio/one.m4a').write_bytes(b'fixture recording')
        data = (self.media / 'audio/one.m4a').read_bytes()
        self.bundle = {'formatVersion': 1, 'course': {'fixture': True}, 'assets': [
            {'path': '/audio/one.m4a', 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}]}
        self.bundle_path = self.root / 'bundle.json'
        self.bundle_path.write_text(json.dumps(self.bundle))
        self.archive = self.root / 'content.tar'

    def archive_with(self, entries):
        with tarfile.open(self.archive, 'w') as archive:
            for name, value, kind in entries:
                info = tarfile.TarInfo(name)
                info.type = kind
                info.size = len(value) if kind == tarfile.REGTYPE else 0
                info.linkname = '/etc/passwd' if kind != tarfile.REGTYPE else ''
                archive.addfile(info, io.BytesIO(value) if info.isfile() else None)

    def normal_entries(self):
        return [('bundle.json', self.bundle_path.read_bytes(), tarfile.REGTYPE),
                ('media/audio/one.m4a', (self.media / 'audio/one.m4a').read_bytes(), tarfile.REGTYPE)]

    def test_roundtrip_install_is_immutable_and_reusable(self):
        package.pack(self.bundle_path, self.media, self.archive)
        stage = self.root / 'stage'
        package.unpack(self.archive, stage)
        target = self.root / 'published'
        package.install(stage, target)
        package.install(stage, target)
        self.assertEqual((target / 'audio/one.m4a').read_bytes(), b'fixture recording')
        bundles = self.root / 'bundles'
        bundles.mkdir()
        (bundles / 'fixture.json').write_bytes(self.bundle_path.read_bytes())
        package.verify_saved(bundles, target)
        (target / 'audio/one.m4a').write_bytes(b'old different content')
        with self.assertRaises(ValueError):
            package.verify_saved(bundles, target)
        with self.assertRaises(ValueError):
            package.install(stage, target)
        self.assertEqual((target / 'audio/one.m4a').read_bytes(), b'old different content')

    def test_received_archive_digest_and_deterministic_pack(self):
        package.pack(self.bundle_path, self.media, self.archive)
        other = self.root / 'second.tar'
        package.pack(self.bundle_path, self.media, other)
        self.assertEqual(self.archive.read_bytes(), other.read_bytes())
        received = self.root / 'received.tar'
        digest = package.receive(io.BytesIO(other.read_bytes()), received)
        self.assertEqual(digest, hashlib.sha256(other.read_bytes()).hexdigest())

    def test_public_directories_ignore_private_umask_and_repair_existing_modes(self):
        (self.media / 'audio/learning').mkdir()
        (self.media / 'audio/one.m4a').rename(self.media / 'audio/learning/one.m4a')
        self.bundle['assets'][0]['path'] = '/audio/learning/one.m4a'
        self.bundle_path.write_text(json.dumps(self.bundle))
        package.pack(self.bundle_path, self.media, self.archive)
        stage, target = self.root / 'stage', self.root / 'published'
        package.unpack(self.archive, stage)
        directories = [target, target / 'audio', target / 'audio/learning']
        for retry in range(2):
            if retry:
                for directory in directories:
                    directory.chmod(0o700)
            previous = os.umask(0o077)
            try:
                package.install(stage, target)
            finally:
                os.umask(previous)
            for directory in directories:
                self.assertEqual(directory.stat().st_mode & 0o777, 0o755)
            self.assertEqual((target / 'audio/learning/one.m4a').stat().st_mode & 0o777, 0o644)

    def test_traversal_links_duplicates_and_unlisted_files_are_rejected(self):
        for entry in [('../escape', b'x', tarfile.REGTYPE), ('/absolute', b'x', tarfile.REGTYPE),
                      ('media/audio/one.m4a', b'', tarfile.SYMTYPE),
                      ('media/audio/one.m4a', b'', tarfile.LNKTYPE),
                      ('media/audio/one.m4a', b'fixture recording', tarfile.REGTYPE),
                      ('media/audio/extra.m4a', b'extra', tarfile.REGTYPE)]:
            with self.subTest(entry=entry[0:1], kind=entry[2]):
                self.archive_with(self.normal_entries() + [entry])
                with self.assertRaises(ValueError):
                    package.unpack(self.archive, self.root / ('stage-' + str(id(entry))))
        self.assertFalse((self.root / 'escape').exists())

    def test_corrupt_or_missing_media_does_not_pass(self):
        for entries in [self.normal_entries()[:1], [self.normal_entries()[0], ('media/audio/one.m4a', b'bad', tarfile.REGTYPE)]]:
            self.archive_with(entries)
            with self.assertRaises(ValueError):
                package.unpack(self.archive, self.root / ('stage-' + str(len(entries))))

    def test_extended_headers_oversized_claims_and_trailing_archives_are_rejected(self):
        for kind, size in [(tarfile.XHDTYPE, 0), (tarfile.REGTYPE, package.MAX_PACKAGE_BYTES + 1)]:
            info = tarfile.TarInfo('bundle.json')
            info.type, info.size = kind, size
            self.archive.write_bytes(info.tobuf(format=tarfile.USTAR_FORMAT) + bytes(1024))
            with self.assertRaises(ValueError):
                package.unpack(self.archive, self.root / 'stage')
        self.archive_with(self.normal_entries())
        self.archive.write_bytes(self.archive.read_bytes() + b'hidden second archive')
        with self.assertRaises(ValueError):
            package.unpack(self.archive, self.root / 'stage')

    def test_manifest_paths_and_limits(self):
        for path in ['/audio/../escape', '/etc/passwd', '/audio//x', '/audio/x\\y', '/audio/%2e%2e/x']:
            with self.subTest(path=path):
                self.bundle['assets'][0]['path'] = path
                with self.assertRaises(ValueError):
                    package.manifest(self.bundle)
        self.bundle['assets'][0]['path'] = '/audio/one.m4a'
        self.bundle['assets'][0]['bytes'] = package.MAX_MEDIA_BYTES + 1
        with self.assertRaises(ValueError):
            package.manifest(self.bundle)
        with self.assertRaises(ValueError):
            package.receive(io.BytesIO(b'x' * 33), self.root / 'oversized.tar', limit=32)

    def test_symlink_source_and_destination_are_rejected(self):
        source = self.media / 'audio/one.m4a'
        source.unlink()
        source.symlink_to(self.bundle_path)
        with self.assertRaises(ValueError):
            package.pack(self.bundle_path, self.media, self.archive)
        source.unlink()
        source.write_bytes(b'fixture recording')
        package.pack(self.bundle_path, self.media, self.archive)
        stage = self.root / 'stage'
        package.unpack(self.archive, stage)
        target = self.root / 'published'
        target.mkdir()
        (target / 'audio').symlink_to(self.media / 'audio')
        with self.assertRaises(ValueError):
            package.install(stage, target)


if __name__ == '__main__':
    unittest.main()
