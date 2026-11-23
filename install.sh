#!/bin/bash
set -e

REPO="dutchess-kuiper/dillion-cli"
BINARY_NAME="dillion"

# Where to install: $INSTALL_DIR if set; else the folder of the dillion already on PATH, so
# `dillion update` replaces the copy that actually runs (no sudo for a user-owned folder like
# ~/.local/bin, and no stale copy left earlier on PATH); else /usr/local/bin.
if [ -z "${INSTALL_DIR:-}" ]; then
  EXISTING="$(command -v "$BINARY_NAME" 2>/dev/null || true)"
  if [ -n "$EXISTING" ] && [ -f "$EXISTING" ]; then
    INSTALL_DIR="$(dirname "$EXISTING")"
  else
    INSTALL_DIR="/usr/local/bin"
  fi
fi

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64) TARGET="dillion-darwin-arm64" ;;
      x86_64) TARGET="dillion-darwin-x64" ;;
      *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      x86_64) TARGET="dillion-linux-x64" ;;
      aarch64) TARGET="dillion-linux-arm64" ;;
      *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

echo "Installing $BINARY_NAME ($OS $ARCH)..."

# Download latest release
URL="https://github.com/$REPO/releases/latest/download/$TARGET"
TMP="$(mktemp)"
curl -fSL "$URL" -o "$TMP"
chmod +x "$TMP"

if [ "$OS" = "Darwin" ]; then
  echo "Ad-hoc signing macOS binary..."
  ENTITLEMENTS="$(mktemp)"
  cat > "$ENTITLEMENTS" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-executable-page-protection</key>
  <true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
EOF
  codesign --force --deep --sign - --entitlements "$ENTITLEMENTS" "$TMP"
  rm -f "$ENTITLEMENTS"
fi

# Install
mkdir -p "$INSTALL_DIR" 2>/dev/null || sudo mkdir -p "$INSTALL_DIR"
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP" "$INSTALL_DIR/$BINARY_NAME"
else
  sudo mv "$TMP" "$INSTALL_DIR/$BINARY_NAME"
fi

echo "Installed $BINARY_NAME to $INSTALL_DIR/$BINARY_NAME"
