#!/usr/bin/env bash
# CouchUI installer.
#
# Every path is derived from this script's own location, so the project can
# live anywhere and be moved later — re-run it after moving and everything
# is rewritten to match.
#
#   ./install.sh                 dependencies + sandbox permissions (minimum to run)
#   ./install.sh --all           everything below
#   ./install.sh --apps          the media/remote apps the tiles point at
#   ./install.sh --autostart     start CouchUI at graphical login
#   ./install.sh --shortcuts     a `couchui` command and an app-menu entry
#   ./install.sh --firewall      open the ports KDE Connect needs
#
# Flags combine: ./install.sh --apps --shortcuts
# Re-running is safe — every step checks before changing anything.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="couch-ui.service"
SERVICE_FILE="$HOME/.config/systemd/user/$SERVICE_NAME"
BIN_DIR="$HOME/.local/bin"
DESKTOP_FILE="$HOME/.local/share/applications/couch-ui.desktop"

DO_DEPS=0; DO_APPS=0; DO_AUTOSTART=0; DO_SHORTCUTS=0; DO_FIREWALL=0
SUMMARY=()

note()  { echo "   $*"; }
step()  { echo; echo "==> $*"; }
warn()  { echo "   ! $*"; }
have()  { command -v "$1" >/dev/null 2>&1; }

if [[ $# -eq 0 ]]; then
  DO_DEPS=1
else
  for arg in "$@"; do
    case "$arg" in
      --all)       DO_DEPS=1; DO_APPS=1; DO_AUTOSTART=1; DO_SHORTCUTS=1; DO_FIREWALL=1 ;;
      --deps)      DO_DEPS=1 ;;
      --apps)      DO_APPS=1 ;;
      --autostart) DO_AUTOSTART=1 ;;
      --shortcuts) DO_SHORTCUTS=1 ;;
      --firewall)  DO_FIREWALL=1 ;;
      -h|--help)   sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
      *)           echo "Unknown option: $arg (try --help)"; exit 1 ;;
    esac
  done
fi

echo "CouchUI installer"
echo "Project directory: $APP_DIR"

# ---------------------------------------------------------------------------
# Node dependencies + Electron's sandbox helper
# ---------------------------------------------------------------------------
fix_sandbox() {
  # Located by search rather than a fixed path: Electron's layout has moved
  # between versions, and this way the fix follows wherever the project is
  # installed instead of assuming one.
  local sandbox
  sandbox="$(find "$APP_DIR/node_modules" -type f -name chrome-sandbox -print -quit 2>/dev/null || true)"

  if [[ -z "$sandbox" ]]; then
    warn "chrome-sandbox not found — Electron may not have finished downloading."
    warn "Run 'npx electron --version' to force it, then re-run this script."
    SUMMARY+=("sandbox permissions: SKIPPED (binary missing)")
    return
  fi

  # 4755 = setuid root. Chromium requires it for its sandbox; without it
  # Electron aborts rather than running unsandboxed.
  local mode owner
  mode="$(stat -c '%a' "$sandbox")"
  owner="$(stat -c '%U' "$sandbox")"
  if [[ "$mode" == "4755" && "$owner" == "root" ]]; then
    note "Already correct: $sandbox"
    SUMMARY+=("sandbox permissions: already correct")
    return
  fi

  note "Setting setuid root on $sandbox (needs sudo)"
  sudo chown root:root "$sandbox"
  sudo chmod 4755 "$sandbox"
  SUMMARY+=("sandbox permissions: fixed")
}

install_deps() {
  step "Installing Node dependencies"
  if ! have npm; then
    warn "npm not found. Install Node.js first:  sudo apt install nodejs npm"
    SUMMARY+=("node dependencies: FAILED (npm missing)")
    return
  fi
  (cd "$APP_DIR" && npm install)
  SUMMARY+=("node dependencies: installed")

  step "Electron sandbox permissions"
  fix_sandbox
}

# ---------------------------------------------------------------------------
# The apps the tiles point at
# ---------------------------------------------------------------------------
apt_install() {
  local missing=()
  for pkg in "$@"; do
    dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
  done
  if [[ ${#missing[@]} -eq 0 ]]; then
    note "Already installed: $*"
    return
  fi
  note "Installing: ${missing[*]}"
  sudo apt-get install -y "${missing[@]}"
}

install_apps() {
  step "System packages"
  sudo apt-get update
  # kdeconnect  - phone as trackpad/keyboard (Settings -> Phone remote)
  # antimicrox  - gamepad to mouse/keyboard, for web pages
  # onboard     - on-screen keyboard
  # cec-utils   - HDMI-CEC tools, if the display path ever supports it
  # rsync/unzip - used by update.sh
  apt_install kdeconnect antimicrox onboard cec-utils v4l-utils rsync unzip curl
  SUMMARY+=("apt packages: done")

  step "Brave (official repo)"
  if have brave-browser || have brave; then
    note "Already installed."
    SUMMARY+=("brave: already installed")
  else
    sudo curl -fsSLo /usr/share/keyrings/brave-browser-archive-keyring.gpg \
      https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg
    echo "deb [signed-by=/usr/share/keyrings/brave-browser-archive-keyring.gpg] https://brave-browser-apt-release.s3.brave.com/ stable main" \
      | sudo tee /etc/apt/sources.list.d/brave-browser-release.list >/dev/null
    sudo apt-get update
    sudo apt-get install -y brave-browser
    SUMMARY+=("brave: installed")
  fi

  step "Flatpak apps (Kodi, Moonlight)"
  if ! have flatpak; then
    apt_install flatpak
  fi
  sudo flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
  # Flatpak rather than snap for Kodi: the snap's confinement blocks
  # external drives and CEC device access, which snap interfaces don't
  # reliably grant. Flatpak permissions are explicit and per-path.
  flatpak install -y --noninteractive flathub tv.kodi.Kodi || warn "Kodi install failed"
  flatpak install -y --noninteractive flathub com.moonlight_stream.Moonlight || warn "Moonlight install failed"
  SUMMARY+=("flatpak apps: Kodi + Moonlight")

  step "Granting Kodi access to your media drives"
  # Covers auto-mounted drives; adjust if your media lives elsewhere.
  flatpak override --user --filesystem=/run/media tv.kodi.Kodi
  flatpak override --user --filesystem=/media tv.kodi.Kodi
  flatpak override --user --filesystem=home tv.kodi.Kodi
  note "Kodi can now read /run/media, /media and your home directory."
  SUMMARY+=("kodi media access: granted")

  step "Spotify (snap — the official Linux build)"
  if snap list spotify >/dev/null 2>&1; then
    note "Already installed."
  else
    sudo snap install spotify || warn "Spotify install failed"
  fi
  SUMMARY+=("spotify: done")

  echo
  warn "config.json still points tiles at whatever commands you had before."
  warn "For the Flatpak apps installed above, the commands are:"
  warn "  Kodi      -> command \"flatpak\", args [\"run\",\"tv.kodi.Kodi\"]"
  warn "  Moonlight -> command \"flatpak\", args [\"run\",\"com.moonlight_stream.Moonlight\"]"
  warn "Left alone deliberately — this script doesn't rewrite your config."
}

# ---------------------------------------------------------------------------
# KDE Connect firewall
# ---------------------------------------------------------------------------
setup_firewall() {
  step "Firewall rules for KDE Connect"
  if ! have ufw; then
    warn "ufw not installed — skipping. Open TCP+UDP 1714-1764 in your firewall."
    SUMMARY+=("firewall: SKIPPED (no ufw)")
    return
  fi
  sudo ufw allow 1714:1764/udp
  sudo ufw allow 1714:1764/tcp
  note "Opened TCP and UDP 1714-1764."
  SUMMARY+=("firewall: opened KDE Connect ports")
}

# ---------------------------------------------------------------------------
# Autostart
# ---------------------------------------------------------------------------
setup_autostart() {
  step "Autostart at graphical login"
  local electron_bin="$APP_DIR/node_modules/electron/cli.js"
  local node_bin; node_bin="$(command -v node || true)"

  if [[ -z "$node_bin" ]]; then
    warn "node not found — skipping autostart."
    SUMMARY+=("autostart: SKIPPED (no node)")
    return
  fi

  mkdir -p "$(dirname "$SERVICE_FILE")"
  # Paths are written out absolute so the unit doesn't depend on PATH or
  # the working directory of the session that starts it.
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=CouchUI (TV-style kiosk launcher)
After=graphical-session.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$node_bin $electron_bin $APP_DIR
Restart=on-failure
RestartSec=3

[Install]
WantedBy=graphical-session.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable "$SERVICE_NAME"
  note "Service written to $SERVICE_FILE"
  SUMMARY+=("autostart: enabled")
}

# ---------------------------------------------------------------------------
# `couchui` command + app menu entry
# ---------------------------------------------------------------------------
setup_shortcuts() {
  step "Command and app-menu entry"
  mkdir -p "$BIN_DIR" "$(dirname "$DESKTOP_FILE")"

  cat > "$BIN_DIR/couchui" <<EOF
#!/usr/bin/env bash
# Generated by CouchUI's install.sh — points at this install.
cd "$APP_DIR" && exec npm start "\$@"
EOF
  chmod +x "$BIN_DIR/couchui"
  note "Command: $BIN_DIR/couchui"

  cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Name=CouchUI
Comment=Controller-first kiosk launcher for the living room
Exec=$BIN_DIR/couchui
Path=$APP_DIR
Terminal=false
Type=Application
Categories=AudioVideo;Player;
StartupWMClass=CouchUI
EOF
  chmod +x "$DESKTOP_FILE"
  note "Menu entry: $DESKTOP_FILE"

  have update-desktop-database && update-desktop-database "$(dirname "$DESKTOP_FILE")" >/dev/null 2>&1 || true

  if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
    warn "$BIN_DIR isn't on your PATH. Add it with:"
    warn "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc && source ~/.bashrc"
  fi
  SUMMARY+=("shortcuts: installed")
}

# ---------------------------------------------------------------------------
[[ $DO_DEPS      == 1 ]] && install_deps
[[ $DO_APPS      == 1 ]] && install_apps
[[ $DO_FIREWALL  == 1 ]] && setup_firewall
[[ $DO_AUTOSTART == 1 ]] && setup_autostart
[[ $DO_SHORTCUTS == 1 ]] && setup_shortcuts

echo
echo "-----------------------------------------"
echo "Summary"
for line in "${SUMMARY[@]}"; do echo "  - $line"; done
echo "-----------------------------------------"
echo
echo "Start it with:  cd $APP_DIR && npm start"
[[ $DO_SHORTCUTS == 1 ]] && echo "            or:  couchui"
[[ $DO_AUTOSTART == 1 ]] && echo "   Start now:   systemctl --user start couch-ui"
[[ $DO_AUTOSTART == 1 ]] && echo "        Logs:   journalctl --user -u couch-ui -f"
echo
echo "Then pair your phone in Settings -> Phone remote, and check the tile"
echo "commands in config.json match what got installed."
