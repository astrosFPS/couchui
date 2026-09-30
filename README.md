# CouchUI

## First run

`config.json` is intentionally not in the repository — it holds your own
Spotify client ID and weather location. The app creates it from
`config.example.json` the first time it starts:

```bash
npm install
npm start          # creates config.json from the example
```

Then edit `config.json` with your own Spotify client ID (see the Spotify
section below) and weather location. It's listed in `.gitignore`, so your
credentials stay local and can't be pushed by accident.

A tile-based, controller-first kiosk launcher for Ubuntu — the "Android TV
box" experience for a PC that boots straight into a living-room UI instead of
a desktop.

## What's here

```
main.js            Electron main process — kiosk window, launches apps
preload.js          Safe bridge between renderer and Node
config.json          Your tiles, commands, and weather location — edit this
renderer/            The UI: clock, weather, tile grid, gamepad handling
install.sh            One-shot setup: npm install + systemd autostart
```

## 1. Prerequisites

```bash
sudo apt update
sudo apt install -y nodejs npm
```

Install the actual apps you want tiles for (adjust to what you use):

```bash
# Brave
sudo apt install -y brave-browser   # or the official Brave apt repo

# Kodi (kodi-omega snap — the command it installs is "kodi-omega", not "kodi")
sudo snap install kodi-omega

# Spotify (snap is simplest)
sudo snap install spotify

# Moonlight
sudo apt install -y moonlight-qt    # or flatpak install flathub com.moonlight_stream.Moonlight
```

## 2. Configure your tiles

Open `config.json`. Each tile has:

- `command` — the binary Ubuntu would run (check with `which <app>` or
  `flatpak run <app-id>` / `snap run <app>` as appropriate)
- `args` — command-line args, e.g. Moonlight's stream options
- `color` — the accent bar color for that tile

Update the VLC tile's media path and the Spotify/Moonlight commands to match
what `which` reports on your machine.

## 3. Run it once to test

```bash
npm install
npm start
```

Press **Esc** to break out of kiosk mode while you're testing (remove that
handler in `main.js` once you're happy, if you want it fully locked down).

### Sandbox permission error

If you see `FATAL:setuid_sandbox_host.cc` mentioning `chrome-sandbox`, npm
didn't set the right ownership/permissions on Electron's sandbox helper.
Fix it once with:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

`install.sh` (step 4 below) does this automatically. Note it needs redoing
any time you reinstall or upgrade the `electron` package, since a fresh
`node_modules/electron` binary loses that ownership.

## 4. Make it boot into this automatically

```bash
./install.sh
```

This installs a systemd **user** service that starts the launcher at your
next graphical login, restarts it if it crashes, and can be checked/disabled
with normal `systemctl --user` commands. If you want it to *replace* your
desktop entirely (no window manager visible at all), pair this with a
minimal, auto-login-enabled session — ask me and I can walk through setting
up LightDM autologin + a bare Openbox session that runs only this app.

## 5. Controller support (8BitDo)

Most 8BitDo pads have an **X-input mode switch** (usually hold Start + X/B on
power-on, check your model's manual). In X-input mode, Linux/Chromium sees it
as a standard gamepad, and the browser's Gamepad API maps it predictably:

- D-pad **or** left stick → move between tiles
- **A** button (index 0) → launch the focused tile

No extra drivers needed — `xboxdrv` or `antimicrox` are only necessary if you
want to remap buttons to keyboard/mouse events system-wide, which this app
doesn't require.

## 6. APK support via Waydroid (the Linux Bluestacks equivalent)

BlueStacks itself doesn't run on Linux. **Waydroid** is the actively
maintained alternative — it runs a real Android system in a container using
your kernel's binder driver, not an emulator, so it's fast.

```bash
sudo apt install -y curl ca-certificates
curl https://repo.waydroid.io/waydroid.gpg | sudo tee /usr/share/keyrings/waydroid.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/waydroid.gpg] https://repo.waydroid.io/ $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/waydroid.list
sudo apt update
sudo apt install -y waydroid

sudo waydroid init          # first-time setup, pulls the Android image
waydroid session start      # starts the container

# Install your sports-streaming APK:
waydroid app install /path/to/your-sports-app.apk

# Find its package name so you can wire up the tile:
waydroid app list
```

Take the package ID from `waydroid app list` (e.g. `com.example.sportsapp`)
and put it in the `sports-apk` tile's `args` in `config.json`. The tile is
already wired to run `waydroid session start` before launching the app, so a
cold boot works without a separate step.

Note: Waydroid needs Wayland (works out of the box on Ubuntu 22.04+'s default
session) and won't run inside a VM without nested virtualization enabled.

**You don't need to hand-pick a package name anymore.** The "Android Apps"
tile is a hub: activating it starts the Waydroid session, calls
`waydroid app list`, and shows every installed Android app (including your
sports app) as its own tile in a sub-grid. Press **B** (or Backspace on a
keyboard) to return to the main grid. Install more APKs any time with
`waydroid app install <file>.apk` and they'll show up automatically next
time you open the hub — no config editing needed.

## 8. Power menu

Top-right, next to the clock, there's a power button (⏻). Open it by
clicking it, pressing **P** on a keyboard, or pressing **Start** on the
controller. It has three options:

- **Exit to Desktop** — quits the launcher immediately, dropping you back to
  whatever's underneath (your normal Ubuntu desktop, if you're running this
  as a regular app rather than a full kiosk session).
- **Restart System** / **Shutdown System** — these run `loginctl reboot` /
  `loginctl poweroff`. Both require a **second confirming press** on the
  same item within 4 seconds, so a stray controller press during a game
  can't reboot the machine. Selecting a different item or letting it time
  out cancels the confirmation.

`loginctl` talks to systemd-logind and works for the active local user
without a password by default on stock Ubuntu. If your setup has tightened
polkit permissions and it silently fails, check
`journalctl --user -u couch-ui` for the error — the fix is usually a
polkit rule granting `org.freedesktop.login1.reboot`/`power-off` to the
active session, or falling back to a passwordless `sudo systemctl reboot`
entry in `/etc/sudoers.d/`.

## 7. Weather

Uses [Open-Meteo](https://open-meteo.com/) — no API key required. Set your
`latitude`/`longitude`/`locationName` in `config.json`. Defaults to Auckland,
NZ.

## Upgrading Electron (security fixes)

If `npm audit` flags the pinned Electron version, bump the version in
`package.json`, then:

```bash
rm -rf node_modules package-lock.json
npm install
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

The `chrome-sandbox` permission fix has to be redone every time — a fresh
Electron download always resets it. `install.sh` handles this automatically
if you re-run it after bumping the version.

## 9. Settings window

Top-right, next to the clock, there's a settings cog (⚙) and a power button
(⏻).

- **Info** — IP address, hostname, CPU model/core count/usage, RAM used vs
  total. Refreshes each time you open the tab.
- **Connections** — toggle Wi-Fi and Bluetooth on/off, see and join nearby
  Wi-Fi networks (password prompt appears inline for secured ones), scan for
  and connect to Bluetooth devices. This shells out to `nmcli`
  (NetworkManager) and `bluetoothctl` (BlueZ) — both are installed by
  default on a standard Ubuntu desktop. First-time Bluetooth **pairing**
  that requires a PIN confirmation isn't handled here (bluetoothctl needs an
  interactive agent for that); pair the device once via a terminal or
  `bluetoothctl`'s own prompt, and this UI can reconnect to it after that.
- **Storage** — every real mounted volume (`df -h`, with tmpfs/overlay/squash
  noise filtered out) and how full each one is.
- **Appearance** — switch the main launcher between **Dark** and **Light**
  themes (applies immediately, no restart), and set a custom wallpaper image
  that shows behind the tiles with the theme's background tinted over it for
  readability. "Clear" removes it and goes back to a solid background.

Theme and wallpaper are saved to a small JSON file in Electron's userData
folder (not `config.json`), so they persist across restarts independently of
your tile setup.

## 10. Spotify (full controller-driven browsing)

The Spotify tile is now a hub, like Waydroid — press A on it and you get a
tile grid of your actual playlists (with cover art), navigable the same way
as everything else. Selecting a playlist starts it playing (shuffled) on
whatever Spotify device is active on this PC.

**One-time setup (you do this once):**

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard),
   log in with your Spotify account (**must be Premium** — the Web API
   rejects playback commands from Free accounts), and create an app.
2. Add this exact Redirect URI in the app's settings:
   `http://127.0.0.1:8888/callback`
3. Copy the app's **Client ID** and paste it into `config.json`:

```json
"spotify": {
  "clientId": "your-client-id-here",
  "redirectUri": "http://127.0.0.1:8888/callback"
}
```

No Client Secret is needed — login uses PKCE, the flow designed for apps
that can't safely store a secret.

**Using it:** open the Spotify tile, select "Log in to Spotify" — a small
window opens with Spotify's own login page, sign in once, it closes itself
and takes you straight to your playlists. After that you stay logged in
(the app refreshes its own token automatically) until you explicitly log out.

**Playback controls work everywhere, not just inside the Spotify tile:**

| Control | Controller | Keyboard |
|---|---|---|
| Play/Pause | **Y** | Spacebar |
| Previous track | **LB** | `[` |
| Next track | **RB** | `]` |

A small "Now Playing" bar appears above the footer whenever something's
active, showing cover art, track, and artist — same idea as a TV OS's
persistent media bar.

**"No Spotify device found" error:** the Web API controls *an existing*
Spotify player, it doesn't create one. Open the Spotify app on this PC once
(or have it running in the background) so there's a device for the API to
target, then try again.

## Extending

- Add more tiles by adding entries to `config.json` — no code changes needed.
- Icons: currently text-only tiles for max distance-legibility; if you want
  app icons, drop PNGs in `assets/` and I can wire up an `icon` field.
- Multiple gamepads / player indicators, a "recently used" row, or a
  Waydroid app *sub-grid* (so one tile expands into all installed Android
  apps) are all natural next steps — say the word.
