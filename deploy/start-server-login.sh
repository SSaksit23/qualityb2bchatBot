#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" -eq 0
if ss -ltnH | awk '{print $4}' | grep -qE ':(5902|6082)$'; then echo 'Login viewer port already occupied'; exit 1; fi
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends x11vnc novnc websockify xauth
install -d -m 0755 /run/qualityb2b-bobo-login
chown qualityb2b-bobo:qualityb2b-bobo /run/qualityb2b-bobo-login
install -m 0644 /var/lib/line-hub/bobo-stage/server-login.mjs /opt/qualityb2b-bobo/deploy/server-login.mjs
install -m 0755 /var/lib/line-hub/bobo-stage/server-login.sh /opt/qualityb2b-bobo/deploy/server-login.sh
systemd-run --unit=qualityb2b-bobo-login --collect --uid=qualityb2b-bobo --gid=qualityb2b-bobo --property=RuntimeMaxSec=25min --property=UMask=0077 /usr/bin/xvfb-run -a -s '-screen 0 1280x900x24 -nolisten tcp' /opt/qualityb2b-bobo/deploy/server-login.sh
