#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Kör installationen med sudo."
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")

apt-get update
export DEBIAN_FRONTEND=noninteractive
apt-get install -y chromium openbox unclutter xinit xserver-xorg python3

if ! id trainmeet-tkl >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/trainmeet-tkl --create-home --shell /usr/sbin/nologin --groups video,input,audio trainmeet-tkl
fi

install -d -m 0755 /opt/trainmeet-tkl /opt/trainmeet-tkl/web /opt/trainmeet-tkl/terminal
cp -R "$PROJECT_DIR/dist/." /opt/trainmeet-tkl/web/
install -m 0755 "$PROJECT_DIR/terminal/trainmeet_tkl_terminal.py" /opt/trainmeet-tkl/terminal/trainmeet_tkl_terminal.py
install -m 0755 "$PROJECT_DIR/packaging/raspberry-pi/trainmeet-tkl-kiosk" /usr/local/bin/trainmeet-tkl-kiosk
install -m 0644 "$PROJECT_DIR/packaging/raspberry-pi/trainmeet-tkl.service" /etc/systemd/system/trainmeet-tkl.service
install -m 0644 "$PROJECT_DIR/packaging/raspberry-pi/trainmeet-tkl-kiosk.service" /etc/systemd/system/trainmeet-tkl-kiosk.service
install -d -o trainmeet-tkl -g trainmeet-tkl -m 0750 /var/lib/trainmeet-tkl

systemctl daemon-reload
systemctl set-default graphical.target
systemctl enable --now trainmeet-tkl.service
systemctl enable trainmeet-tkl-kiosk.service
systemctl restart trainmeet-tkl-kiosk.service

echo "TrainMeet TKL Terminal är installerad. Första-start-guiden visas på pekskärmen."
