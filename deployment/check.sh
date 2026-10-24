#!/bin/bash
set -euo pipefail
for file in deployment/*.sh; do bash -n "$file"; done
python3 -m py_compile deployment/verify-public.py
python3 -m unittest discover -s deployment -p 'test_*.py'
for origin in 'http://example.com' 'https://user:password@example.com' 'https://example.com/private?token=fixture'; do
    if python3 deployment/verify-public.py "$origin" >/dev/null 2>&1; then exit 1; fi
done
for command in '' 'deploy main' 'deploy ../main' 'deploy 123;id' 'sh' 'deploy aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa extra' \
    'publish-content main' 'publish-content ../bundle.tar' 'publish-content aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa extra' \
    'rollback-content main' 'rollback-content aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;id' 'sftp' 'scp -t /tmp'; do
    if SSH_ORIGINAL_COMMAND="$command" bash deployment/ssh-command.sh >/dev/null 2>&1; then
        echo 'Unexpected SSH command accepted' >&2
        exit 1
    fi
done
if bash deployment/release.sh not-a-sha >/dev/null 2>&1; then exit 1; fi
if bash deployment/content.sh publish not-a-sha >/dev/null 2>&1; then exit 1; fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cat > "$work/sudo" <<'SH'
#!/bin/bash
case "$*" in
  '-n /usr/local/sbin/japanese-release aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' | \
  '-n /usr/local/sbin/japanese-content publish aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' | \
  '-n /usr/local/sbin/japanese-content rollback aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') exit 0 ;;
  *) exit 1 ;;
esac
SH
chmod 700 "$work/sudo"
PATH="$work:$PATH" SSH_ORIGINAL_COMMAND='deploy aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' bash deployment/ssh-command.sh
PATH="$work:$PATH" SSH_ORIGINAL_COMMAND='publish-content aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' bash deployment/ssh-command.sh
PATH="$work:$PATH" SSH_ORIGINAL_COMMAND='rollback-content aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' bash deployment/ssh-command.sh
echo 'Release command validation passed'
