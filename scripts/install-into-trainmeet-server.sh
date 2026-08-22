#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
SERVER_DIR=${1:-"$PROJECT_DIR/../trainmeet-server"}
TARGET="$SERVER_DIR/src/tmbox_gateway/tkl"

if [ ! -f "$SERVER_DIR/pyproject.toml" ]; then
  echo "TrainMeet Server hittades inte: $SERVER_DIR"
  exit 1
fi

if [ ! -d "$SERVER_DIR/src/tmbox_gateway/tkl" ]; then
  echo "Hittade inte $SERVER_DIR/src/tmbox_gateway/tkl."
  echo "Skapa inte katalogen för hand - fel sökväg här ger en föräldralös"
  echo "kopia som ingen serverar, och /tkl/ blir kvar på den gamla bygget."
  exit 1
fi

cd "$PROJECT_DIR"
npm run build
mkdir -p "$TARGET/assets"
find "$TARGET/assets" -mindepth 1 -maxdepth 1 -type f -delete
cp dist/index.html dist/manifest.webmanifest dist/trainmeet-icon.png dist/trainmeet-logo.png "$TARGET/"
cp dist/assets/* "$TARGET/assets/"

echo "TrainMeet TKL installerades i TrainMeet Server under /tkl/."
