#!/usr/bin/env python3
"""Bounded content-only tar transport; Course validation stays in scripts/content.ts."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tarfile
import tempfile

MAX_PACKAGE_BYTES = 512 * 1024 * 1024
MAX_MEDIA_BYTES = 500 * 1024 * 1024
MAX_BUNDLE_BYTES = 12 * 1024 * 1024
MAX_FILES = 20000
PREFIXES = ('/audio/', '/word-illustrations/', '/counters/')


def stream_digest(stream):
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        digest.update(chunk)
    return digest.hexdigest()


def asset_path(value):
    if not isinstance(value, str) or not value.startswith(PREFIXES):
        raise ValueError('Invalid media prefix')
    if not re.fullmatch(r'/[A-Za-z0-9._/-]+', value) or any(x in ('', '.', '..') for x in value[1:].split('/')):
        raise ValueError('Unsafe media path')
    return value[1:]


def manifest(bundle):
    if not isinstance(bundle, dict) or bundle.get('formatVersion') != 1 or not isinstance(bundle.get('assets'), list):
        raise ValueError('Invalid content bundle')
    if len(bundle['assets']) > MAX_FILES:
        raise ValueError('Too many media files')
    assets = {}
    for item in bundle['assets']:
        if not isinstance(item, dict):
            raise ValueError('Invalid media metadata')
        name = asset_path(item.get('path'))
        size = item.get('bytes')
        digest = item.get('sha256')
        if name in assets or type(size) is not int or size < 0 or not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest):
            raise ValueError('Invalid or duplicate media metadata')
        assets[name] = item
    if sum(item['bytes'] for item in assets.values()) > MAX_MEDIA_BYTES:
        raise ValueError('Media package is too large')
    return assets


def regular_path(root, relative):
    root = Path(root)
    if root.is_symlink():
        raise ValueError('Symlink media root')
    target = root
    for component in PurePosixPath(relative).parts:
        target = target / component
        if target.is_symlink():
            raise ValueError('Symlink media path')
    if target.exists() and not target.is_file():
        raise ValueError('Media path is not a regular file')
    return target


def verified_file(root, relative, metadata):
    path = regular_path(root, relative)
    if not path.is_file() or path.stat().st_size != metadata['bytes']:
        raise ValueError('Missing media or wrong size: ' + relative)
    with path.open('rb') as stream:
        if stream_digest(stream) != metadata['sha256']:
            raise ValueError('Media checksum mismatch: ' + relative)
    return path


def load_bundle(path):
    if Path(path).stat().st_size > MAX_BUNDLE_BYTES:
        raise ValueError('Bundle is too large')
    bundle = json.loads(Path(path).read_text())
    return bundle, manifest(bundle)


def pack(bundle_path, media_root, output):
    bundle_path, output = Path(bundle_path), Path(output)
    bundle, assets = load_bundle(bundle_path)
    paths = [(name, verified_file(media_root, name, item)) for name, item in assets.items()]
    # Tar headers and alignment must fit the same limit enforced by the receiver.
    if sum(item['bytes'] for item in assets.values()) + bundle_path.stat().st_size + (len(paths) + 1) * 1024 + 10240 > MAX_PACKAGE_BYTES:
        raise ValueError('Archive is too large')
    with output.open('xb') as stream, tarfile.open(fileobj=stream, mode='w', format=tarfile.USTAR_FORMAT) as archive:
        for name, path in [('bundle.json', bundle_path)] + [('media/' + name, path) for name, path in paths]:
            info = tarfile.TarInfo(name)
            info.size = path.stat().st_size
            info.mode = 0o644
            with path.open('rb') as source:
                archive.addfile(info, source)


def receive(stream, output, limit=MAX_PACKAGE_BYTES):
    digest = hashlib.sha256()
    size = 0
    with Path(output).open('xb') as target:
        while True:
            chunk = stream.read(min(1024 * 1024, limit - size + 1))
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                raise ValueError('Archive is too large')
            digest.update(chunk)
            target.write(chunk)
    return digest.hexdigest()


def regular_tar_headers(path):
    # tarfile otherwise consumes hidden PAX/GNU metadata before yielding a member.
    # This transport only emits regular USTAR files, so reject extensions before parsing payloads.
    size = path.stat().st_size
    count = 0
    with path.open('rb') as source:
        while True:
            header = source.read(512)
            if len(header) != 512:
                raise ValueError('Truncated tar header')
            if not any(header):
                if source.read(512) != bytes(512):
                    raise ValueError('Invalid tar terminator')
                while True:
                    trailing = source.read(1024 * 1024)
                    if not trailing:
                        return
                    if any(trailing):
                        raise ValueError('Unexpected data after tar terminator')
            member = tarfile.TarInfo.frombuf(header, 'utf-8', 'strict')
            count += 1
            end = source.tell() + ((member.size + 511) // 512) * 512
            if header[257:263] != b'ustar\x00' or not member.isfile() or count > MAX_FILES + 1:
                raise ValueError('Only regular USTAR files are accepted')
            if member.size < 0 or member.size > MAX_PACKAGE_BYTES or end > size:
                raise ValueError('Invalid tar payload size')
            source.seek(end)


def unpack(archive_path, destination):
    archive_path, destination = Path(archive_path), Path(destination)
    if archive_path.stat().st_size > MAX_PACKAGE_BYTES:
        raise ValueError('Archive is too large')
    regular_tar_headers(archive_path)
    # Do not use extractall: reject links, special files, duplicates and unlisted paths.
    with tarfile.open(archive_path, 'r:') as archive:
        members = {}
        total = 0
        for member in archive:
            if not member.isfile() or member.name in members or len(members) >= MAX_FILES + 1:
                raise ValueError('Invalid archive member')
            if member.name != 'bundle.json':
                if not member.name.startswith('media/'):
                    raise ValueError('Unexpected archive path')
                asset_path('/' + member.name[len('media/'):])
            maximum = MAX_BUNDLE_BYTES if member.name == 'bundle.json' else MAX_MEDIA_BYTES
            total += member.size
            if member.size < 0 or member.size > maximum or total > MAX_PACKAGE_BYTES:
                raise ValueError('Unpacked content is too large')
            members[member.name] = member
        if 'bundle.json' not in members:
            raise ValueError('Missing bundle')
        bundle_bytes = archive.extractfile(members['bundle.json']).read(MAX_BUNDLE_BYTES + 1)
        bundle = json.loads(bundle_bytes)
        assets = manifest(bundle)
        if set(members) != {'bundle.json'} | {'media/' + name for name in assets}:
            raise ValueError('Archive does not match manifest')
        # Verify every byte before any destination is installed or any CLI can activate.
        for name, item in assets.items():
            member = members['media/' + name]
            if member.size != item['bytes'] or stream_digest(archive.extractfile(member)) != item['sha256']:
                raise ValueError('Archive checksum mismatch')
        destination.mkdir(mode=0o700)
        for name, member in members.items():
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as output:
                shutil.copyfileobj(archive.extractfile(member), output)


def install(stage, media_root):
    stage, media_root = Path(stage), Path(media_root)
    bundle, assets = load_bundle(stage / 'bundle.json')
    # Validate ALL existing paths before adding files; conflicting immutable bytes never change.
    for name, item in assets.items():
        verified_file(stage / 'media', name, item)
        if regular_path(media_root, name).exists():
            verified_file(media_root, name, item)
    media_root.mkdir(parents=True, exist_ok=True, mode=0o755)
    for name, item in assets.items():
        target = regular_path(media_root, name)
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        descriptor, temporary = tempfile.mkstemp(prefix='.incoming-', dir=target.parent)
        try:
            with os.fdopen(descriptor, 'wb') as output, (stage / 'media' / name).open('rb') as source:
                shutil.copyfileobj(source, output)
                output.flush()
                os.fsync(output.fileno())
            os.chmod(temporary, 0o644)
            os.link(temporary, target)  # Atomic no-overwrite, including an unexpected concurrent writer.
        finally:
            Path(temporary).unlink(missing_ok=True)


def verify_saved(bundles, media_root):
    bundles = Path(bundles)
    if not bundles.is_dir() or bundles.is_symlink():
        raise ValueError('Missing publication bundle backup')
    for path in sorted(bundles.glob('*.json')):
        if path.is_symlink():
            raise ValueError('Symlink publication bundle')
        bundle, assets = load_bundle(path)
        for name, item in assets.items():
            verified_file(media_root, name, item)


def main(args):
    if len(args) == 4 and args[0] == 'pack':
        pack(*map(Path, args[1:]))
    elif len(args) == 3 and args[0] == 'receive' and re.fullmatch('[0-9a-f]{64}', args[1]):
        root = Path(args[2])
        archive = root / 'content.tar'
        if receive(sys.stdin.buffer, archive) != args[1]:
            raise ValueError('Transport checksum mismatch')
        unpack(archive, root / 'package')
    elif len(args) == 3 and args[0] == 'install':
        install(Path(args[1]), Path(args[2]))
    elif len(args) == 3 and args[0] == 'verify-backup':
        verify_saved(Path(args[1]), Path(args[2]))
    else:
        raise ValueError('Usage: content-package.py pack BUNDLE MEDIA OUTPUT | receive SHA STAGE | install STAGE MEDIA | verify-backup BUNDLES MEDIA')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (ValueError, OSError, tarfile.TarError) as error:
        print('Content package rejected: ' + str(error), file=sys.stderr)
        sys.exit(65)
