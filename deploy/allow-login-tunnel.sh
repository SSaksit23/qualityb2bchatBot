#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" -eq 0
keyfile=$(getent passwd linehub | cut -d: -f6)/.ssh/authorized_keys
test -f "$keyfile"
test ! -e /etc/ssh/sshd_config.d/10-bobo-login.conf
cp -a "$keyfile" /run/qualityb2b-bobo-login/authorized_keys.before
chmod 0600 /run/qualityb2b-bobo-login/authorized_keys.before
python3 - "$keyfile" <<'PY'
import sys
from pathlib import Path
p=Path(sys.argv[1]);s=p.read_text()
assert s.count('restrict ')==1
p.write_text(s.replace('restrict ','restrict,port-forwarding,permitopen="127.0.0.1:6082" ',1))
PY
cat > /etc/ssh/sshd_config.d/10-bobo-login.conf <<'EOF'
Match User linehub
    AllowTcpForwarding local
    PermitOpen 127.0.0.1:6082
Match all
EOF
if ! /usr/sbin/sshd -t; then cp -a /run/qualityb2b-bobo-login/authorized_keys.before "$keyfile"; rm /etc/ssh/sshd_config.d/10-bobo-login.conf; exit 1; fi
systemctl reload ssh
