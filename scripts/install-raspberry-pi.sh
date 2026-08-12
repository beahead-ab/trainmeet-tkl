#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Kör installationen med sudo."
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
KIOSK_USER=${TRAINMEET_TKL_USER:-${SUDO_USER:-}}

if [ -z "$KIOSK_USER" ] || [ "$KIOSK_USER" = root ]; then
  KIOSK_USER=$(getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 {print $1; exit}')
fi
if [ -z "$KIOSK_USER" ] || ! id "$KIOSK_USER" >/dev/null 2>&1; then
  echo "Ingen vanlig Raspberry Pi-användare hittades. Skapa användaren i Raspberry Pi Imager först."
  exit 1
fi
KIOSK_HOME=$(getent passwd "$KIOSK_USER" | cut -d: -f6)

if [ ! -f /etc/rpi-issue ] && ! grep -qi raspberry /proc/device-tree/model 2>/dev/null; then
  echo "Varning: installationen verkar inte köras på Raspberry Pi OS."
fi

echo "Installerar TrainMeet TKL Terminal för användaren $KIOSK_USER …"
apt-get update
export DEBIAN_FRONTEND=noninteractive
apt-get install -y avahi-utils chromium curl nodejs npm polkitd python3 rpd-wayland-core util-linux wlr-randr

if ! id trainmeet-tkl >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/trainmeet-tkl --create-home --shell /usr/sbin/nologin trainmeet-tkl
fi

install -d -m 0755 /opt/trainmeet-tkl /opt/trainmeet-tkl/web /opt/trainmeet-tkl/terminal
find /opt/trainmeet-tkl/web -mindepth 1 -delete
cp -R "$PROJECT_DIR/dist/." /opt/trainmeet-tkl/web/
install -m 0755 "$PROJECT_DIR/terminal/trainmeet_tkl_terminal.py" /opt/trainmeet-tkl/terminal/trainmeet_tkl_terminal.py
install -m 0755 "$PROJECT_DIR/packaging/raspberry-pi/trainmeet-tkl-kiosk" /usr/local/bin/trainmeet-tkl-kiosk
install -m 0755 "$PROJECT_DIR/packaging/raspberry-pi/trainmeet-tkl-update" /usr/local/sbin/trainmeet-tkl-update
install -m 0644 "$PROJECT_DIR/packaging/raspberry-pi/trainmeet-tkl.service" /etc/systemd/system/trainmeet-tkl.service
install -m 0644 "$PROJECT_DIR/packaging/raspberry-pi/trainmeet-tkl-update.service" /etc/systemd/system/trainmeet-tkl-update.service
install -m 0644 "$PROJECT_DIR/packaging/raspberry-pi/50-trainmeet-tkl-update.rules" /etc/polkit-1/rules.d/50-trainmeet-tkl-update.rules
install -d -o trainmeet-tkl -g trainmeet-tkl -m 0750 /var/lib/trainmeet-tkl
printf '%s\n' "$KIOSK_USER" > /etc/trainmeet-tkl-kiosk-user
printf '%s\n' "${TRAINMEET_TKL_VERSION:-main}" > /opt/trainmeet-tkl/VERSION

AUTOSTART_DIR="$KIOSK_HOME/.config/labwc"
AUTOSTART_FILE="$AUTOSTART_DIR/autostart"
install -d -o "$KIOSK_USER" -g "$KIOSK_USER" -m 0755 "$AUTOSTART_DIR"
touch "$AUTOSTART_FILE"
if ! grep -q 'trainmeet-tkl-kiosk' "$AUTOSTART_FILE"; then
  printf '\n# TrainMeet TKL Terminal\n/usr/local/bin/trainmeet-tkl-kiosk &\n' >> "$AUTOSTART_FILE"
fi
chown "$KIOSK_USER:$KIOSK_USER" "$AUTOSTART_FILE"
chmod 0644 "$AUTOSTART_FILE"

systemctl daemon-reload
systemctl restart polkit.service || true
systemctl enable --now trainmeet-tkl.service
systemctl set-default graphical.target
raspi-config nonint do_wayland W2 || true
raspi-config nonint do_boot_behaviour B4 || true
raspi-config nonint do_boot_wait 0 || true
raspi-config nonint do_blanking 1 || true
raspi-config nonint do_boot_splash 0 || true

echo
echo "TrainMeet TKL Terminal är installerad."
echo "Starta om Raspberry Pi:n: sudo reboot"
echo "Efter omstart visas första-start-guiden direkt på pekskärmen."
