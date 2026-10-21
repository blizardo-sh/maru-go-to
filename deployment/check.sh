#!/bin/bash
set -euo pipefail
for file in deployment/*.sh; do bash -n "$file"; done
python3 -m py_compile deployment/verify-public.py
python3 -m unittest discover -s deployment -p 'test_verify_public.py'
for origin in 'http://example.com' 'https://user:password@example.com' 'https://example.com/private?token=fixture'; do
    if python3 deployment/verify-public.py "$origin" >/dev/null 2>&1; then exit 1; fi
done
for command in '' 'deploy main' 'deploy ../main' 'deploy 123;id' 'sh' 'deploy aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa extra'; do
    if SSH_ORIGINAL_COMMAND="$command" bash deployment/ssh-command.sh >/dev/null 2>&1; then
        echo 'Unexpected SSH command accepted' >&2
        exit 1
    fi
done
if bash deployment/release.sh not-a-sha >/dev/null 2>&1; then exit 1; fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cat > "$work/sudo" <<'SH'
#!/bin/bash
[[ "$*" == '-n /usr/local/sbin/japanese-release aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' ]]
SH
chmod 700 "$work/sudo"
PATH="$work:$PATH" SSH_ORIGINAL_COMMAND='deploy aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' bash deployment/ssh-command.sh
echo 'Release command validation passed'
