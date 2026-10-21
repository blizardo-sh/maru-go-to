#!/bin/bash
set -euo pipefail
for file in deployment/*.sh; do bash -n "$file"; done
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
