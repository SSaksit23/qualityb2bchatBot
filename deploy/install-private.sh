#!/usr/bin/env bash
set -euo pipefail
stage=/var/lib/line-hub/bobo-stage
cd "$stage"
test "$(id -u)" -eq 0
sha256sum --check SHA256SUMS
test ! -e /opt/qualityb2b-bobo
test -f private.env
if ss -ltnH | awk '{print $4}' | grep -qE ':3212$'; then exit 1; fi
nginx -t
id qualityb2b-bobo >/dev/null 2>&1 || useradd --system --home-dir /var/lib/qualityb2b-bobo --shell /usr/sbin/nologin qualityb2b-bobo
install -d -m 0755 /opt/qualityb2b-bobo
tar -xzf release.tar.gz -C /opt/qualityb2b-bobo --no-same-owner
chown -R root:root /opt/qualityb2b-bobo
chmod -R go-w /opt/qualityb2b-bobo
cd /opt/qualityb2b-bobo
/opt/line-hub/runtime/bin/node --test test.mjs
install -d -m 0700 /etc/qualityb2b-bobo
install -m 0600 "$stage/private.env" /etc/qualityb2b-bobo/bobo.env
rm "$stage/private.env"
install -m 0644 deploy/qualityb2b-bobo.service /etc/systemd/system/qualityb2b-bobo.service
install -m 0644 deploy/nginx.conf /etc/nginx/snippets/qualityb2b-bobo.conf
systemctl daemon-reload
systemctl enable --now qualityb2b-bobo
for attempt in {1..15}; do curl -fsS http://127.0.0.1:3212/health && break; sleep 1; done
curl -fsS http://127.0.0.1:3212/health
site=$(readlink -f /etc/nginx/sites-enabled/hermes-line)
cp -a "$site" "$stage/nginx-before-bobo.conf"
python3 - "$site" <<'PY'
import sys
from pathlib import Path
p=Path(sys.argv[1]); s=p.read_text()
marker='    include /etc/nginx/snippets/line-coach.conf;'
assert s.count(marker)==1
s=s.replace(marker,marker+'\n    include /etc/nginx/snippets/qualityb2b-bobo.conf;')
p.write_text(s)
PY
if ! nginx -t; then cp -a "$stage/nginx-before-bobo.conf" "$site"; systemctl stop qualityb2b-bobo; exit 1; fi
systemctl reload nginx
curl -fsS https://srv1925838.hstgr.cloud/bobo/health
echo 'Private chat service ready; booking remains disabled.'
