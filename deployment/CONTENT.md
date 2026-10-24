# Content publication transport

Content source remains reviewed files in Git. `scripts/content.ts` validates and packs the authored Course and binary media into a versioned bundle. The API stores publications in PostgreSQL; a separate manual workflow activates them without building or restarting app images. A publication must be compatible with the currently released API's validator.

## Package and SSH protocol

```sh
bun scripts/content.ts pack /tmp/bundle.json
python3 scripts/content-package.py pack /tmp/bundle.json public /tmp/content.tar
sha256sum /tmp/content.tar
```

The output file must not already exist. The uncompressed USTAR archive contains only `bundle.json` and its declared binary files under `media/audio/`, `media/counters/`, or `media/word-illustrations/`. Reports and mutable metadata manifests are not media. Limits: archive 512 MiB, media 500 MiB, bundle 12 MiB, 20,000 files. The transport rejects links, special/extended headers, traversal, duplicate/unlisted paths, trailing archives, wrong lengths and checksums.

Using the existing pinned host key, deploy identity and port 5555:

```sh
ssh [existing pinned options] japanese-deploy@HOST 'publish-content ARCHIVE_SHA256' < /tmp/content.tar
ssh [existing pinned options] japanese-deploy@HOST 'rollback-content PUBLICATION_ID' < /dev/null
```

Both arguments are exactly 64 lowercase hexadecimal characters. The archive checksum is a transport checksum, not the publication ID returned by the database CLI. No shell, SFTP, SCP, destination path, upload HTTP endpoint or new credential is enabled. The existing `deploy <40-hex commit>` protocol is unchanged.

The host serializes content commands with app deployment using the same lock. It bounds lock acquisition, input reception and one-off API commands. Reception stages only public data, then runs the currently installed API image's `verify-media` against the complete staged media. Existing media with different bytes are rejected. Installation only adds immutable files; publication activation runs last in the DB transaction. A failed validation leaves the active publication unchanged. Unused files left by a failed DB publication are harmless and are retained.

## Host prerequisites

For an existing host, an administrator must install the reviewed `content.sh` and `content-package.py` as root-owned `/usr/local/sbin/japanese-content` and `/usr/local/sbin/japanese-content-package.py`, update `japanese-ssh`, `japanese-backup`, Compose and this account's sudo rule, and create `/var/lib/japanese-content/{media,bundles}` with mode 755. Do not rerun the one-time network provisioning script. `provision.sh` includes these files for a new host.

The first app release must include the publication schema, compatible CLI, media mounts and Caddy configuration. Only later content-only publications can use that deployed version. Installing code or opening a PR does not perform those host changes.

API and web mount `/var/lib/japanese-content/media` at `/content:ro`. Only the restricted host publisher writes it. Caddy first reads `/content`, then the image's `/srv` for existing bundled media; a missing media path returns 404 and never `index.html`. New publication validation requires every declared file in `/content`, without fallback. Keep historical media and publication records for pinned/open attempts and rollback; this implementation does not garbage-collect them.

## Workflow and recovery

**Actions → Content publication**, on `main` only, offers `publish` or `rollback`. It uses the existing deploy secrets. Publish packages the checked-out authored files and streams the archive to the current installed API; it does not build an image. Rollback takes a stored publication ID. PR checks still run for content edits. Content/media-only pushes to `main` do not start app-image publication; manual Delivery remains unchanged.

Offsite backups include the PostgreSQL dump, append-only media, saved publication bundles and transport scripts. Media are installed before DB activation and never deleted, so the earlier DB dump's referenced bytes remain available during backup. The restore check verifies saved bundle media hashes before restoring the dump to its disposable database. Legacy bootstrap media remain in the pinned app image. Recover DB, `/var/lib/japanese-content` and pinned image configuration together; a DB-only restore is insufficient for separately published media.

Local checks: `bash deployment/check.sh`. The existing Linux image gate additionally packs/verifies content with a non-root read-only API image and checks a read-only Caddy media mount, legacy fallback and missing-media 404, without a database or published port.
