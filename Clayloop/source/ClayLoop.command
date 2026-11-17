#!/bin/bash
# Double-click to start ClayLoop on macOS (opens in its own Chrome window).
# Sessions live in the dedicated Chrome profile below, so ALWAYS start ClayLoop with this script
# (or ClayLoop-Exhibition.command), which use the same profile and port.
cd "$(dirname "$0")" || exit 1
PORT=4173
PROFILE="$HOME/Library/Application Support/ClayLoop/chrome-profile"
MODE="${1:-}"
if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "ClayLoop needs Node.js" message "Install Node.js 20+ from nodejs.org (one time), then double-click again."'
  exit 1
fi
[ -d node_modules ] || npm install
[ -f dist/index.html ] || npm run build
if ! lsof -i :$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  node node_modules/vite/bin/vite.js preview --port $PORT --strictPort > /tmp/clayloop-server.log 2>&1 &
  for i in $(seq 1 40); do curl -s "http://localhost:$PORT/" >/dev/null && break; sleep 0.25; done
fi
URL="http://localhost:$PORT/"
mkdir -p "$PROFILE"
CHROME="/Applications/Google Chrome.app"
if [ ! -d "$CHROME" ]; then
  osascript -e 'display alert "Google Chrome not found" message "Install Google Chrome, or open http://localhost:4173 in Chrome yourself."'
  open "$URL"; exit 0
fi
if [ "$MODE" = "exhibition" ]; then
  open -na "$CHROME" --args --user-data-dir="$PROFILE" --kiosk --no-first-run --autoplay-policy=no-user-gesture-required "${URL}#/exhibition"
else
  open -na "$CHROME" --args --user-data-dir="$PROFILE" --no-first-run --app="$URL" --start-maximized
fi
echo "ClayLoop is running at $URL  (close this window to keep it running; quit Chrome with ⌘Q)"
