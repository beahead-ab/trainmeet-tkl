#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Installationen behöver administratörsrättighet. Kör:"
  echo "  curl -fsSL https://raw.githubusercontent.com/beahead-ab/trainmeet-tkl/main/install.sh | sudo sh"
  exit 1
fi

apt-get update
export DEBIAN_FRONTEND=noninteractive
apt-get install -y ca-certificates curl nodejs npm

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT INT TERM
curl -fsSL https://github.com/beahead-ab/trainmeet-tkl/archive/refs/heads/main.tar.gz -o "$TEMP_DIR/trainmeet-tkl.tar.gz"
tar -xzf "$TEMP_DIR/trainmeet-tkl.tar.gz" -C "$TEMP_DIR"
SOURCE_DIR=$(find "$TEMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)
VERSION=$(curl -fsSL https://api.github.com/repos/beahead-ab/trainmeet-tkl/commits/main | python3 -c 'import json,sys; print(json.load(sys.stdin)["sha"][:8])')

cd "$SOURCE_DIR"
npm ci --no-audit --no-fund
npm run build
TRAINMEET_TKL_VERSION="$VERSION" ./scripts/install-raspberry-pi.sh
