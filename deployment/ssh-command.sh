#!/bin/bash
set -euo pipefail
if [[ ${SSH_ORIGINAL_COMMAND:-} =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
    exec sudo -n /usr/local/sbin/japanese-release "${BASH_REMATCH[1]}"
fi
if [[ ${SSH_ORIGINAL_COMMAND:-} =~ ^publish-content\ ([0-9a-f]{64})$ ]]; then
    exec sudo -n /usr/local/sbin/japanese-content publish "${BASH_REMATCH[1]}"
fi
if [[ ${SSH_ORIGINAL_COMMAND:-} =~ ^rollback-content\ ([0-9a-f]{64})$ ]]; then
    exec sudo -n /usr/local/sbin/japanese-content rollback "${BASH_REMATCH[1]}"
fi
echo 'Only deploy <40-hex SHA>, publish-content <64-hex archive SHA> or rollback-content <64-hex publication ID> is allowed.' >&2
exit 64
