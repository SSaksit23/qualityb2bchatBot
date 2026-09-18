#!/usr/bin/env bash
set -euo pipefail
systemctl stop qualityb2b-bobo-login 2>/dev/null || true
keyfile=$(getent passwd linehub | cut -d: -f6)/.ssh/authorized_keys
python3 - "$keyfile" <<'PY'
import sys
from pathlib import Path
p=Path(sys.argv[1]);s=p.read_text();s=s.replace('restrict,port-forwarding,permitopen="127.0.0.1:6082" ','restrict ');p.write_text(s)
PY
rm -f /etc/ssh/sshd_config.d/10-bobo-login.conf
/usr/sbin/sshd -t
systemctl reload ssh
