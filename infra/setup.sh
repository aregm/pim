#!/usr/bin/env sh
# Installs the pinned iii engine and the Python worker runtime into .tooling/. Idempotent. No global changes.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
LOCK="$ROOT/infra/engine.lock"
VERSION=$(sed -n 's/^version=//p' "$LOCK")
BASE_URL=$(sed -n 's/^base_url=//p' "$LOCK")
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) TARGET=aarch64-apple-darwin ;;
  *) echo "setup: unsupported host $(uname -s)-$(uname -m); M0 supports macOS on Apple Silicon" >&2; exit 1 ;;
esac
EXPECTED=$(sed -n "s/^$TARGET.sha256=//p" "$LOCK")
[ -n "$EXPECTED" ] || { echo "setup: no checksum for $TARGET in engine.lock" >&2; exit 1; }
BIN_DIR="$ROOT/.tooling/iii/bin"
if [ -x "$BIN_DIR/iii" ] && [ "$("$BIN_DIR/iii" --version 2>/dev/null)" = "$VERSION" ]; then
  echo "engine: iii $VERSION already installed"
else
  TMP=$(mktemp -d)
  curl -fsSL -o "$TMP/iii.tar.gz" "$BASE_URL/iii-$TARGET.tar.gz"
  ACTUAL=$(shasum -a 256 "$TMP/iii.tar.gz" | cut -d' ' -f1)
  [ "$ACTUAL" = "$EXPECTED" ] || { echo "setup: checksum mismatch for iii-$TARGET.tar.gz: $ACTUAL" >&2; exit 1; }
  mkdir -p "$BIN_DIR" && tar -xzf "$TMP/iii.tar.gz" -C "$BIN_DIR" && chmod +x "$BIN_DIR/iii" && rm -rf "$TMP"
  echo "engine: installed iii $("$BIN_DIR/iii" --version) into .tooling/iii/bin"
fi
PY="$ROOT/.tooling/py"
if [ ! -x "$PY/bin/python" ]; then
  python3 -m venv "$PY"
fi
"$PY/bin/python" -m pip install --quiet --disable-pip-version-check -r "$ROOT/workers-py/media/requirements.txt"
echo "python: $("$PY/bin/python" --version) with $("$PY/bin/python" -m pip show iii-sdk 2>/dev/null | sed -n 's/^Version: /iii-sdk /p')"
# The Electron binary is downloaded by electron's own postinstall; run it when npm skipped it.
if [ ! -e "$ROOT/node_modules/electron/dist" ] && [ -f "$ROOT/node_modules/electron/install.js" ]; then
  (cd "$ROOT" && node node_modules/electron/install.js) && echo "electron: binary installed"
fi
