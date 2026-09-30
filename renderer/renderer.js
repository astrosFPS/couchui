// ---------- Clock ----------
// Timezone and 12/24h come from Settings → Location. Intl applies the IANA
// database's DST rules itself, so a zone like Pacific/Auckland shifts on its
// own at the right dates with nothing to update here.
let clockSettings = { timeZone: 'system', clockFormat: 'auto', showSeconds: false };
let clockTimer = null;

function updateClock() {
  const now = new Date();
  const opts = {};
  if (clockSettings.timeZone && clockSettings.timeZone !== 'system') {
    opts.timeZone = clockSettings.timeZone;
  }
  const timeOpts = { ...opts, hour: '2-digit', minute: '2-digit' };
  if (clockSettings.showSeconds) timeOpts.second = '2-digit';
  if (clockSettings.clockFormat === '12') timeOpts.hour12 = true;
  if (clockSettings.clockFormat === '24') timeOpts.hour12 = false;

  try {
    document.getElementById('clock-time').textContent =
      now.toLocaleTimeString([], timeOpts);
    document.getElementById('clock-date').textContent =
      now.toLocaleDateString([], { ...opts, weekday: 'long', day: 'numeric', month: 'short' });
  } catch (err) {
    // An invalid saved timezone shouldn't leave a blank clock.
    reportError('clock', `Invalid timezone "${clockSettings.timeZone}": ${err.message}`);
    clockSettings.timeZone = 'system';
  }
}

function restartClock() {
  clearInterval(clockTimer);
  // Tick every second only when seconds are actually displayed.
  clockTimer = setInterval(updateClock, clockSettings.showSeconds ? 1000 : 15000);
  updateClock();
}
restartClock();

// ---------- Weather (Open-Meteo, no API key required) ----------
// Basic WMO weather_code -> icon/label mapping. Nothing fancy, just the essentials.
function describeWeatherCode(code) {
  if (code === 0) return { icon: '☀️', label: 'Clear' };
  if ([1, 2].includes(code)) return { icon: '🌤️', label: 'Partly cloudy' };
  if (code === 3) return { icon: '☁️', label: 'Cloudy' };
  if ([45, 48].includes(code)) return { icon: '🌫️', label: 'Fog' };
  if ([51, 53, 55, 56, 57].includes(code)) return { icon: '🌦️', label: 'Drizzle' };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { icon: '🌧️', label: 'Rain' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { icon: '❄️', label: 'Snow' };
  if ([95, 96, 99].includes(code)) return { icon: '⛈️', label: 'Thunderstorm' };
  return { icon: '', label: '' };
}

let weatherSettings = {
  style: 'detailed', units: 'celsius',
  showIcon: true, showCondition: true, showLocation: true,
  showFeelsLike: false, showHumidity: false, showWind: false,
};

async function loadWeather(config) {
  const { latitude, longitude, locationName } = config.weather || {};
  const weatherEl = document.querySelector('.weather');
  if (latitude == null || longitude == null) return;

  // 'minimal' is temperature only — no point asking for fields we won't show.
  const wantsExtras = weatherSettings.style !== 'minimal'
    && (weatherSettings.showFeelsLike || weatherSettings.showHumidity || weatherSettings.showWind);
  const fields = ['temperature_2m', 'weather_code']
    .concat(wantsExtras ? ['apparent_temperature', 'relative_humidity_2m', 'wind_speed_10m'] : []);

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}`
      + `&current=${fields.join(',')}&temperature_unit=${weatherSettings.units}`;
    const res = await fetch(url);
    const data = await res.json();
    const cur = data.current;
    const temp = Math.round(cur.temperature_2m);
    const condition = describeWeatherCode(cur.weather_code);

    weatherEl.dataset.style = weatherSettings.style;
    document.getElementById('weather-temp').textContent = `${temp}°`;

    // Condition line — icon and label toggle independently.
    const conditionParts = [];
    if (weatherSettings.showIcon && condition.icon) conditionParts.push(condition.icon);
    if (weatherSettings.showCondition && condition.label) conditionParts.push(condition.label);
    document.getElementById('weather-condition').textContent = conditionParts.join(' ');

    // Detail line — place plus any enabled extras, hidden entirely in
    // 'minimal' style so the temperature stands alone.
    const detailParts = [];
    if (weatherSettings.style !== 'minimal') {
      if (weatherSettings.showLocation && locationName) detailParts.push(locationName);
      if (weatherSettings.showFeelsLike && cur.apparent_temperature != null) {
        detailParts.push(`Feels ${Math.round(cur.apparent_temperature)}°`);
      }
      if (weatherSettings.showHumidity && cur.relative_humidity_2m != null) {
        detailParts.push(`${Math.round(cur.relative_humidity_2m)}%`);
      }
      if (weatherSettings.showWind && cur.wind_speed_10m != null) {
        detailParts.push(`${Math.round(cur.wind_speed_10m)} km/h`);
      }
    }
    document.getElementById('weather-place').textContent = detailParts.join(' · ');
  } catch (err) {
    reportError('weather', err.message);
    document.getElementById('weather-place').textContent = 'Weather unavailable';
  }
}

// ---------- App state ----------
let appConfig = null;
let view = 'home';           // 'home' | 'waydroid' | 'spotify' | 'submenu'
let spotifyView = 'home';    // 'home' | 'search' — sub-state within the 'spotify' view
let submenuStack = [];       // stack of submenu tile objects — supports nested submenus
let tileEls = [];
let grid = [];                // rows of indices into tileEls, for 2D nav
let focusRow = 0;
let focusCol = 0;

let volumeOpen = false;      // volume popup owns input while true
let powerMenuOpen = false;
let powerFocusIndex = 0;
let confirmAction = null;     // action awaiting a second press
let confirmTimeout = null;

const tilesContainer = document.getElementById('tiles');
const viewHeading = document.getElementById('view-heading');
const viewTitle = document.getElementById('view-title');
const powerBtn = document.getElementById('power-btn');
const powerMenu = document.getElementById('power-menu');
const powerMenuItems = Array.from(document.querySelectorAll('.power-menu-item'));

// Shared by every place a tile gets built (home grid, submenus) — one
// place that knows what each tile type does when activated.
function dispatchTile(tile, el) {
  if (tile.type === 'waydroid-hub') openWaydroidHub(tile);
  else if (tile.type === 'spotify-hub') openSpotifyHome();
  else if (tile.type === 'submenu') openSubmenu(tile);
  else launchTile(tile.id, el);
}

function tileToItem(tile) {
  return {
    id: tile.id,
    label: tile.label,
    subtitle: tile.subtitle || '',
    color: tile.color,
    icon: tile.icon || (tile.type === 'submenu' ? 'folder' : undefined),
    iconImage: tile.imageUrl || null,
    onActivate: (el) => dispatchTile(tile, el),
  };
}

// Waydroid/Spotify's own "Back" tile, and the B button from inside them,
// return here — home if they were opened from the true home screen, or
// back into the submenu that opened them, so a hub inside a submenu
// doesn't dump you all the way out of it.
function goHome() {
  if (submenuStack.length) renderSubmenu();
  else renderHome();
}

// ---------- Submenus (grouping tiles, e.g. "Media", "Gaming") ----------
function openSubmenu(tile) {
  view = 'submenu';
  submenuStack.push(tile);
  renderSubmenu();
}

function backFromSubmenu() {
  submenuStack.pop();
  if (submenuStack.length) renderSubmenu();
  else renderHome();
}

function renderSubmenu() {
  view = 'submenu';
  const tile = submenuStack[submenuStack.length - 1];
  viewHeading.hidden = false;
  viewTitle.textContent = `${tile.label} — B to go back`;

  const parent = submenuStack[submenuStack.length - 2];
  const items = [
    {
      id: '__back__',
      label: '← Back',
      subtitle: parent ? parent.label : 'Home',
      color: '#5A5D66',
      onActivate: () => backFromSubmenu(),
    },
    ...(tile.tiles || []).map(tileToItem),
  ];
  renderTileGrid(items);
}

// ---------- Home view ----------
function renderHome() {
  view = 'home';
  submenuStack = [];
  viewHeading.hidden = true;
  renderTileGrid(appConfig.tiles.map(tileToItem));
}

// ---------- Waydroid sub-grid ----------
async function openWaydroidHub(tile) {
  view = 'waydroid';
  viewHeading.hidden = false;
  viewTitle.textContent = 'Android Apps — B to go back';
  tilesContainer.innerHTML = '<div class="tile-subtitle" style="padding:12px;">Loading Android apps…</div>';

  if (tile.prelaunch) {
    // Fire and forget — starts the waydroid session if it isn't already running.
    window.launcher.launchTile(tile.id).catch(() => {});
  }

  const result = await window.launcher.listWaydroidApps();
  if (!result.ok) {
    reportError('waydroid-list', result.error);
    tilesContainer.innerHTML = '<div class="tile-subtitle" style="padding:12px;">Couldn\'t load Android apps — see error.log for details.</div>';
    return;
  }
  const items = [
    {
      id: '__back__',
      label: '← Back',
      subtitle: 'Home',
      color: '#5A5D66',
      onActivate: () => goHome(),
    },
    {
      id: '__install_apk__',
      label: '＋ Install APK',
      subtitle: 'Browse for a file',
      color: '#7ED17E',
      onActivate: () => openApkBrowser(tile),
    },
    // No apps yet is a normal state on a fresh Waydroid, not an error —
    // the Install tile above is exactly what you need at that point, so
    // the grid still renders rather than being replaced by a message.
    ...result.apps.map((app) => ({
      id: app.packageName,
      label: app.name,
      subtitle: 'Android app',
      color: '#2D9CDB',
      onActivate: (el) => launchWaydroidApp(app.packageName, el),
    })),
  ];
  renderTileGrid(items);
}

// ---------- APK browser (Waydroid → Install APK) ----------
// A tile-grid file browser rather than the native file dialog, which is
// mouse-only and would mean reaching for a keyboard mid-couch. Starts in
// Downloads (where APKs generally land) and shows only .apk files by
// default, with a toggle for everything else.
let apkBrowserStack = [];      // directories visited, for B to walk back out
let apkShowAllFiles = false;
let apkBrowserTile = null;     // the Waydroid tile, to return to afterwards

async function openApkBrowser(tile) {
  apkBrowserTile = tile;
  apkShowAllFiles = false;
  const paths = await window.launcher.getCommonPaths();
  apkBrowserStack = [];
  showApkDirectory(paths.downloads);
}

async function showApkDirectory(dirPath, { push = true } = {}) {
  view = 'apk-browser';
  viewHeading.hidden = false;

  const result = await window.launcher.listDirectory({ dirPath, showAll: apkShowAllFiles });
  if (!result.ok) {
    reportError('list-directory', `${dirPath}: ${result.error}`);
    // A missing or unreadable folder shouldn't strand you — fall back to
    // home rather than leaving an empty grid with no way out.
    const paths = await window.launcher.getCommonPaths();
    if (dirPath !== paths.home) return showApkDirectory(paths.home, { push });
    tilesContainer.innerHTML = '<div class="tile-subtitle" style="padding:12px;">Couldn\'t read that folder — see error.log.</div>';
    return;
  }

  if (push) apkBrowserStack.push(result.path);
  viewTitle.textContent = `Install APK — ${result.path} — B to go back`;

  const items = [
    {
      id: '__back__',
      label: '← Back',
      subtitle: apkBrowserStack.length > 1 ? 'Previous folder' : 'Android Apps',
      color: '#5A5D66',
      onActivate: () => goBack(),
    },
    {
      id: '__toggle_filter__',
      label: apkShowAllFiles ? 'Showing all files' : 'Showing APKs only',
      subtitle: apkShowAllFiles ? 'Select to show APKs only' : 'Select to show all files',
      color: '#E8A33D',
      onActivate: () => {
        apkShowAllFiles = !apkShowAllFiles;
        // Re-render the same folder without adding another stack entry.
        apkBrowserStack.pop();
        showApkDirectory(result.path);
      },
    },
  ];

  if (result.parent) {
    items.push({
      id: '__parent__',
      label: '↑ Up one level',
      subtitle: result.parent,
      color: '#5A5D66',
      onActivate: () => showApkDirectory(result.parent),
    });
  }

  result.folders.forEach((f) => {
    items.push({
      id: `dir:${f.path}`,
      label: f.name,
      subtitle: 'Folder',
      icon: 'folder',
      color: '#2D9CDB',
      onActivate: () => showApkDirectory(f.path),
    });
  });

  result.files.forEach((f) => {
    items.push({
      id: `file:${f.path}`,
      label: f.name,
      subtitle: f.isApk ? 'APK — select to install' : 'Not an APK',
      color: f.isApk ? '#7ED17E' : '#5A5D66',
      onActivate: (el) => {
        if (!f.isApk) {
          // Visible in "all files" mode, but Waydroid can only install APKs.
          reportError('install-apk', `${f.name} is not an APK`);
          return;
        }
        installApk(f.path, el);
      },
    });
  });

  renderTileGrid(items);
}

async function installApk(apkPath, el) {
  el.classList.add('launching');
  viewTitle.textContent = 'Installing… this can take a while — B to go back';

  const result = await window.launcher.installApk(apkPath);
  el.classList.remove('launching');

  if (!result.ok) {
    reportError('install-apk', result.error);
    viewTitle.textContent = 'Install failed — see error.log — B to go back';
    return;
  }
  // Back to the app list, which re-queries Waydroid — so the new app
  // appearing there is the confirmation, rather than trusting an exit code.
  openWaydroidHub(apkBrowserTile);
}

async function launchWaydroidApp(packageName, el) {
  el.classList.add('launching');
  await window.launcher.launchWaydroidApp(packageName);
  setTimeout(() => el.classList.remove('launching'), 800);
}

// ---------- Spotify home (rows: search, jump back in, playlists, mood) ----------
async function openSpotifyHome() {
  view = 'spotify';
  spotifyView = 'home';
  viewHeading.hidden = false;
  viewTitle.textContent = 'Spotify — B to go back';

  const authResult = await window.launcher.spotify.isAuthed();
  if (!authResult.authed) {
    renderTileGrid([
      {
        id: '__back__',
        label: '← Back',
        subtitle: 'Home',
        color: '#5A5D66',
        onActivate: () => goHome(),
      },
      {
        id: '__spotify_login__',
        label: 'Log in to Spotify',
        subtitle: 'Opens a login window',
        color: '#1DB954',
        onActivate: async (el) => {
          el.classList.add('launching');
          const result = await window.launcher.spotify.login();
          el.classList.remove('launching');
          if (result.ok) openSpotifyHome();
          else reportError('spotify-login', result.error);
        },
      },
    ]);
    return;
  }

  tilesContainer.classList.remove('rows-mode');
  tilesContainer.innerHTML = '<div class="tile-subtitle" style="padding:12px;">Loading Spotify…</div>';
  const result = await window.launcher.spotify.getHome();
  if (!result.ok) {
    reportError('spotify-home', result.error);
    tilesContainer.innerHTML = '<div class="tile-subtitle" style="padding:12px;">Couldn\'t load Spotify — see error.log for details.</div>';
    return;
  }

  const sections = [
    {
      items: [
        {
          id: '__back__',
          label: '← Back',
          subtitle: 'Home',
          color: '#5A5D66',
          onActivate: () => goHome(),
        },
        {
          id: '__search__',
          label: '🔍 Search Spotify',
          subtitle: 'Press A to type',
          color: '#1DB954',
          onActivate: () => openKeyboard('', runSpotifySearch),
        },
      ],
    },
  ];

  if (result.recentlyPlayed.length) {
    sections.push({
      title: 'Jump back in',
      items: result.recentlyPlayed.map((item) => spotifyPlayableTile(item)),
    });
  }

  // What's actually coming up next, so the queue is visible rather than
  // something you add to blindly.
  const queueResult = await window.launcher.spotify.getQueue();
  if (queueResult.ok && queueResult.queue.length) {
    sections.push({
      title: 'Up Next',
      items: queueResult.queue.map((item) => spotifyPlayableTile(item)),
    });
  }

  if ((result.recentTracks || []).length) {
    sections.push({
      title: 'Recently Played Songs — X to queue',
      items: result.recentTracks.map((item) => spotifyPlayableTile(item)),
    });
  }

  if (result.playlists.length) {
    const pinnedIds = new Set(result.pinnedPlaylistIds || []);
    // Pinned playlists first, in whatever order they were pinned.
    const sortedPlaylists = [...result.playlists].sort(
      (a, b) => Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id))
    );
    sections.push({
      title: 'Your Playlists — X to pin/unpin',
      items: sortedPlaylists.map((pl) => spotifyPlayableTile({
        id: pl.id,
        name: pl.name,
        subtitle: pinnedIds.has(pl.id) ? '📌 Pinned' : '',
        image: pl.image,
        uri: pl.uri,
        playlistId: pl.id,
      })),
    });
  }

  result.moodRows.forEach((row) => {
    sections.push({
      title: row.title,
      items: row.items.map((item) => spotifyPlayableTile(item)),
    });
  });

  renderTileRows(sections);
}

function spotifyPlayableTile(item) {
  return {
    id: item.id,
    label: item.name,
    subtitle: item.subtitle || '',
    image: item.image,
    color: '#1DB954',
    playlistId: item.playlistId || null,
    // Only individual tracks can be queued — queueing a whole playlist
    // isn't a thing the API supports.
    trackUri: item.uri && item.uri.startsWith('spotify:track:') ? item.uri : null,
    onActivate: (el) => playSpotifyItem(item.uri, el),
  };
}

async function playSpotifyItem(uri, el) {
  el.classList.add('launching');
  const result = await window.launcher.spotify.play(uri);
  el.classList.remove('launching');
  if (!result.ok) reportError('spotify-play', result.error);
  else refreshNowPlaying();
}

// ---------- Spotify search results ----------
async function runSpotifySearch(query) {
  spotifyView = 'search';
  viewTitle.textContent = `Spotify search: "${query}" — B to go back`;
  tilesContainer.classList.remove('rows-mode');
  tilesContainer.innerHTML = '<div class="tile-subtitle" style="padding:12px;">Searching…</div>';

  const result = await window.launcher.spotify.search(query);
  if (!result.ok) {
    reportError('spotify-search', result.error);
    tilesContainer.innerHTML = '<div class="tile-subtitle" style="padding:12px;">Search failed — see error.log for details.</div>';
    return;
  }

  const sections = [
    {
      items: [
        {
          id: '__back__',
          label: '← Back',
          subtitle: 'Spotify home',
          color: '#5A5D66',
          onActivate: () => openSpotifyHome(),
        },
        {
          id: '__search_again__',
          label: '🔍 Search again',
          subtitle: query,
          color: '#1DB954',
          onActivate: () => openKeyboard(query, runSpotifySearch),
        },
      ],
    },
  ];

  if (result.tracks.length) {
    sections.push({ title: 'Tracks', items: result.tracks.map((t) => spotifyPlayableTile(t)) });
  }
  if (result.albums.length) {
    sections.push({ title: 'Albums', items: result.albums.map((a) => spotifyPlayableTile(a)) });
  }
  if (result.playlists.length) {
    sections.push({ title: 'Playlists', items: result.playlists.map((p) => spotifyPlayableTile(p)) });
  }

  if (sections.length === 1) {
    reportError('spotify-search', `No results for "${query}"`);
  }

  renderTileRows(sections);
}

// ---------- Tile icons (inline SVG, currentColor so they pick up each
// tile's own --accent and stay legible in both light and dark theme) ----------
const ICONS = {
  browser: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="9"/>
    <ellipse cx="12" cy="12" rx="4" ry="9"/>
    <path d="M3 9h18M3 15h18"/>
  </svg>`,
  spotify: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M6 8c4.5-1.5 10-1 13 1.2"/>
    <path d="M6.5 11.5c4-1.3 8.5-1 11.5 1"/>
    <path d="M7 15c3-1 7-1 10 1"/>
  </svg>`,
  controller: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6 9h12a4 4 0 0 1 4 4.5l-.6 3a2.4 2.4 0 0 1-4.3 1.1L15 15H9l-2.1 2.6A2.4 2.4 0 0 1 2.6 16.5L2 13.5A4 4 0 0 1 6 9Z"/>
    <path d="M7 12v3M5.5 13.5h3"/>
    <circle cx="15.5" cy="11.5" r=".8" fill="currentColor" stroke="none"/>
    <circle cx="17.5" cy="13.5" r=".8" fill="currentColor" stroke="none"/>
  </svg>`,
  movie: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 9.5 4 5h16l1 4.5"/>
    <path d="M3 9.5h18V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5Z"/>
    <path d="m5.5 5 2 4.5M10 5l2 4.5M14.5 5l2 4.5"/>
  </svg>`,
  folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h9A1.5 1.5 0 0 1 21 9v8.5A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5Z"/>
  </svg>`,
};

function tileInnerHTML(item) {
  // A custom image (config.json `image`) replaces the built-in SVG icon.
  // onerror hides it rather than leaving a broken-image glyph, so a file
  // that's moved or deleted degrades to a plain tile instead of looking
  // like a rendering fault.
  const icon = item.iconImage
    ? `<div class="tile-icon tile-icon--image"><img src="${item.iconImage}" alt="" onerror="this.parentNode.style.display='none'" /></div>`
    : (item.icon && ICONS[item.icon] ? `<div class="tile-icon">${ICONS[item.icon]}</div>` : '');
  if (item.image) {
    // Text lives in its own solid-colored panel below the artwork, not
    // overlaid on top of it — an image's own colors can't be relied on to
    // contrast against text in both light and dark theme, but var(--surface)
    // and var(--text) always do, since they're the same pair used
    // everywhere else in the app.
    return `
      <div class="tile-art" style="background-image: url('${item.image}')"></div>
      <div class="tile-text">
        <div class="tile-label">${item.label}</div>
        <div class="tile-subtitle">${item.subtitle || ''}</div>
      </div>
    `;
  }
  return `
      ${icon}
      <div class="tile-label">${item.label}</div>
      <div class="tile-subtitle">${item.subtitle || ''}</div>
    `;
}

// ---------- Generic tile grid rendering + 2D navigation ----------
function renderTileGrid(items) {
  tilesContainer.classList.remove('rows-mode');
  tilesContainer.innerHTML = '';
  tileEls = [];

  items.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'tile';
    el.tabIndex = 0;
    el.style.setProperty('--accent', item.color || '#E8A33D');
    if (item.image) el.classList.add('has-image');
    el.innerHTML = tileInnerHTML(item);
    el.addEventListener('click', () => item.onActivate(el));
    tilesContainer.appendChild(el);
    tileEls.push({ id: item.id, el, onActivate: item.onActivate, playlistId: item.playlistId || null, trackUri: item.trackUri || null });
  });

  requestAnimationFrame(buildGrid);
}

// Renders a home-screen-style layout: a vertical stack of horizontally
// scrolling rows, each with an optional heading (e.g. "Jump back in").
// Unlike renderTileGrid, the nav grid is built directly from `sections`
// instead of measured from the DOM afterwards — each section is already
// exactly one nav row, so there's nothing to detect.
function renderTileRows(sections) {
  tilesContainer.classList.add('rows-mode');
  tilesContainer.innerHTML = '';
  tileEls = [];
  grid = [];

  sections.forEach((section) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'tile-row';

    if (section.title) {
      const heading = document.createElement('div');
      heading.className = 'tile-row-title';
      heading.textContent = section.title;
      rowEl.appendChild(heading);
    }

    const stripEl = document.createElement('div');
    stripEl.className = 'tile-row-strip';
    const rowIndices = [];

    section.items.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'tile tile--row';
      el.tabIndex = 0;
      el.style.setProperty('--accent', item.color || '#E8A33D');
      if (item.image) el.classList.add('has-image');
      el.innerHTML = tileInnerHTML(item);
      el.addEventListener('click', () => item.onActivate(el));
      stripEl.appendChild(el);
      rowIndices.push(tileEls.length);
      tileEls.push({ id: item.id, el, onActivate: item.onActivate, playlistId: item.playlistId || null, trackUri: item.trackUri || null });
    });

    rowEl.appendChild(stripEl);
    // Floating overlay scrollbar for this row — see wireRowScrollbar().
    const scrollbarEl = document.createElement('div');
    scrollbarEl.className = 'row-scrollbar';
    const thumbEl = document.createElement('div');
    thumbEl.className = 'row-scrollbar-thumb';
    scrollbarEl.appendChild(thumbEl);
    rowEl.appendChild(scrollbarEl);
    wireRowScrollbar(stripEl, scrollbarEl, thumbEl);

    tilesContainer.appendChild(rowEl);
    if (rowIndices.length) grid.push(rowIndices);
  });

  focusRow = 0;
  focusCol = 0;
  applyFocus();
}

// A floating "overlay scrollbar" (macOS/mobile style) for a row strip: a
// slim pill synced to actual scroll position, that fades in while
// scrolling (including the programmatic scroll from D-Pad focus) and
// fades back out shortly after — replacing the native OS scrollbar, which
// stayed on screen permanently and ate into the row's height.
function wireRowScrollbar(stripEl, scrollbarEl, thumbEl) {
  let hideTimer = null;

  function update() {
    const { scrollWidth, clientWidth, scrollLeft } = stripEl;
    if (scrollWidth <= clientWidth + 1) {
      scrollbarEl.classList.remove('visible');
      return;
    }
    const thumbWidthPct = Math.max(8, (clientWidth / scrollWidth) * 100);
    const maxScroll = scrollWidth - clientWidth;
    const thumbLeftPct = maxScroll > 0 ? (scrollLeft / maxScroll) * (100 - thumbWidthPct) : 0;
    thumbEl.style.width = `${thumbWidthPct}%`;
    thumbEl.style.left = `${thumbLeftPct}%`;

    scrollbarEl.classList.add('visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => scrollbarEl.classList.remove('visible'), 900);
  }

  stripEl.addEventListener('scroll', update);
  requestAnimationFrame(update);
}


// Works out which tiles share a visual row, so left/right moves along a row
// and up/down moves between rows.
//
// This used to compare offsetTop for *exact* equality, which meant a single
// pixel of difference — from a wrapped label, an uneven tile height, or
// sub-pixel layout rounding — silently split one visual row into two
// logical ones. The symptom was navigation that stopped partway along a
// row (a phantom "end of row"), and up/down landing on the first tile
// because the short row clamped the column index to 0.
//
// Comparing against the row's own top with a tolerance of half a tile
// height is what we actually mean by "on the same row": tiles that
// visually overlap vertically belong together, however their tops round.
function buildGrid() {
  grid = [];
  if (!tileEls.length) {
    focusRow = 0;
    focusCol = 0;
    return;
  }

  let row = [];
  let rowTop = null;

  tileEls.forEach((t, i) => {
    const top = t.el.offsetTop;
    const tolerance = Math.max(20, t.el.offsetHeight / 2);

    if (rowTop === null || Math.abs(top - rowTop) <= tolerance) {
      // Anchor on the first tile of the row, not the previous tile, so a
      // run of slightly-increasing tops can't creep into a false split.
      if (rowTop === null) rowTop = top;
      row.push(i);
    } else {
      grid.push(row);
      row = [i];
      rowTop = top;
    }
  });

  if (row.length) grid.push(row);
  focusRow = 0;
  focusCol = 0;
  applyFocus();
}

function applyFocus() {
  tileEls.forEach((t) => t.el.classList.remove('focused'));
  const idx = grid[focusRow]?.[focusCol];
  if (idx == null) return;
  const target = tileEls[idx].el;
  target.classList.add('focused');
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function moveFocus(dRow, dCol) {
  if (!grid.length) return;
  let r = focusRow + dRow;
  r = Math.max(0, Math.min(grid.length - 1, r));
  let c = focusCol + dCol;
  const rowLen = grid[r].length;
  c = Math.max(0, Math.min(rowLen - 1, c));
  focusRow = r;
  focusCol = c;
  applyFocus();
}

async function launchTile(tileId, el) {
  el.classList.add('launching');
  const result = await window.launcher.launchTile(tileId);
  if (!result.ok) reportError('launch-tile', `Couldn't launch: ${result.error}`);
  setTimeout(() => el.classList.remove('launching'), 800);
}

// ---------- Error reporting (goes to error.log, not the screen) ----------
// Errors used to pop up as an on-screen toast or replace the tile grid with
// raw command output — useful for debugging but ugly sitting over the
// wallpaper in normal use. Everything now goes to error.log instead, via
// main.js. Nothing here shows anything on screen.
async function reportError(source, message) {
  const text = message || 'Unknown error';
  console.error(`[${source}]`, text);
  try {
    await window.launcher.logError(source, text);
  } catch (err) {
    // If even the IPC call fails there's nowhere else useful to put this.
    console.error('Failed to forward error to error.log:', err);
  }
}

// Anything that slips past a try/catch — unexpected JS errors, rejected
// promises nobody awaited — still ends up in error.log instead of just
// disappearing into devtools nobody's looking at on a TV.
window.addEventListener('error', (e) => {
  reportError('window-error', e.error ? (e.error.stack || e.error.message) : e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  reportError('unhandled-rejection', reason instanceof Error ? (reason.stack || reason.message) : String(reason));
});

function activateFocused() {
  const idx = grid[focusRow]?.[focusCol];
  if (idx == null) return;
  const t = tileEls[idx];
  t.onActivate(t.el);
}

// Pins/unpins the focused tile if — and only if — it's a playlist tile in
// the Spotify home "Your Playlists" row (playlistId is only ever set
// there). Harmless no-op anywhere else, so it's safe to wire to a
// global button/key without needing to guard the call site.
// X is contextual: on a playlist tile it pins, on a track tile it queues,
// and anywhere else it toggles shuffle — so the button always does the
// most useful thing for whatever is focused.
async function contextActionFocused() {
  const idx = grid[focusRow]?.[focusCol];
  const tile = idx == null ? null : tileEls[idx];
  if (tile?.playlistId) return togglePinFocused();
  if (tile?.trackUri) return queueFocused();
  return spotifyShuffle();
}

async function togglePinFocused() {
  const idx = grid[focusRow]?.[focusCol];
  if (idx == null) return;
  const tile = tileEls[idx];
  if (!tile?.playlistId) return;
  const result = await window.launcher.spotify.togglePin(tile.playlistId);
  if (!result.ok) {
    reportError('spotify-pin', result.error);
    return;
  }
  openSpotifyHome();
}

function goBack() {
  if (view === 'waydroid') {
    goHome();
  } else if (view === 'apk-browser') {
    // Walk back out the way you came in, one folder per press, rather than
    // jumping straight out of the browser from wherever you'd got to.
    apkBrowserStack.pop();
    const previous = apkBrowserStack.pop();
    if (previous) showApkDirectory(previous);
    else openWaydroidHub(apkBrowserTile);
  } else if (view === 'spotify') {
    if (spotifyView === 'search') openSpotifyHome();
    else goHome();
  } else if (view === 'submenu') {
    backFromSubmenu();
  }
}

// ---------- On-screen keyboard (controller-friendly typing, e.g. Spotify search) ----------
const KEYBOARD_ROWS = [
  '1234567890'.split(''),
  'qwertyuiop'.split(''),
  'asdfghjkl'.split(''),
  'zxcvbnm'.split(''),
];

const keyboardEl = document.getElementById('keyboard');
const keyboardPreviewEl = document.getElementById('keyboard-preview');
const keyboardKeysEl = keyboardEl.querySelector('.keyboard-keys');

let keyboardOpen = false;
let keyboardQuery = '';
let keyboardOnSubmit = null;
// The hub's own nav state, saved while the keyboard borrows the shared
// grid/tileEls/focus variables, and restored if the user cancels.
let savedNav = null;

function openKeyboard(initialQuery, onSubmit) {
  savedNav = { grid, tileEls, focusRow, focusCol };
  keyboardOpen = true;
  keyboardQuery = initialQuery || '';
  keyboardOnSubmit = onSubmit;
  keyboardEl.classList.add('open');
  renderKeyboardGrid();
  updateKeyboardPreview();
}

function closeKeyboard() {
  keyboardOpen = false;
  keyboardOnSubmit = null;
  keyboardEl.classList.remove('open');
  if (savedNav) {
    ({ grid, tileEls, focusRow, focusCol } = savedNav);
    savedNav = null;
    applyFocus();
  }
}

function updateKeyboardPreview() {
  keyboardPreviewEl.textContent = keyboardQuery || 'Type to search…';
}

function appendQueryChar(ch) {
  keyboardQuery += ch;
  updateKeyboardPreview();
}

function backspaceQuery() {
  keyboardQuery = keyboardQuery.slice(0, -1);
  updateKeyboardPreview();
}

function submitSearch() {
  const query = keyboardQuery.trim();
  const onSubmit = keyboardOnSubmit;
  keyboardOpen = false;
  keyboardOnSubmit = null;
  keyboardEl.classList.remove('open');
  savedNav = null; // discarded — the submit handler builds a fresh results grid
  if (query && onSubmit) onSubmit(query);
}

function makeKeyEl(label, onActivate) {
  const el = document.createElement('div');
  el.className = 'keyboard-key';
  el.tabIndex = 0;
  el.textContent = label;
  el.addEventListener('click', onActivate);
  return el;
}

function renderKeyboardGrid() {
  keyboardKeysEl.innerHTML = '';
  tileEls = [];
  grid = [];

  KEYBOARD_ROWS.forEach((row) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'keyboard-row';
    const rowIndices = [];
    row.forEach((ch) => {
      const onActivate = () => appendQueryChar(ch);
      const el = makeKeyEl(ch.toUpperCase(), onActivate);
      rowEl.appendChild(el);
      rowIndices.push(tileEls.length);
      tileEls.push({ id: `key-${ch}`, el, onActivate });
    });
    keyboardKeysEl.appendChild(rowEl);
    grid.push(rowIndices);
  });

  const actionRow = document.createElement('div');
  actionRow.className = 'keyboard-row';
  const actionIndices = [];
  [
    { label: 'Space', onActivate: () => appendQueryChar(' ') },
    { label: '⌫ Delete', onActivate: () => backspaceQuery() },
    { label: 'Cancel', onActivate: () => closeKeyboard() },
    { label: 'Search', onActivate: () => submitSearch() },
  ].forEach((action) => {
    const el = makeKeyEl(action.label, action.onActivate);
    el.classList.add('keyboard-key--wide');
    actionRow.appendChild(el);
    actionIndices.push(tileEls.length);
    tileEls.push({ id: `action-${action.label}`, el, onActivate: action.onActivate });
  });
  keyboardKeysEl.appendChild(actionRow);
  grid.push(actionIndices);

  focusRow = 0;
  focusCol = 0;
  applyFocus();
}

// ---------- Settings cog ----------
document.getElementById('settings-btn').addEventListener('click', () => {
  window.launcher.powerAction('settings');
});

// ---------- Power menu ----------
const powerWrap = document.getElementById('power-wrap');
let hoverCloseTimer = null;

function openPowerMenu() {
  powerMenuOpen = true;
  powerFocusIndex = 0;
  clearConfirm();
  powerMenu.classList.add('open');
  applyPowerFocus();
}

function closePowerMenu() {
  powerMenuOpen = false;
  clearConfirm();
  powerMenu.classList.remove('open');
  powerBtn.classList.remove('focused');
}

function togglePowerMenu() {
  if (powerMenuOpen) closePowerMenu();
  else openPowerMenu();
}

// Hover-to-open, like a normal desktop tray menu — closes shortly after the
// pointer leaves both the button and the menu, unless it re-enters in time.
function cancelHoverClose() {
  if (hoverCloseTimer) {
    clearTimeout(hoverCloseTimer);
    hoverCloseTimer = null;
  }
}

function scheduleHoverClose() {
  cancelHoverClose();
  hoverCloseTimer = setTimeout(() => closePowerMenu(), 300);
}

powerWrap.addEventListener('mouseenter', () => {
  cancelHoverClose();
  openPowerMenu();
});
powerWrap.addEventListener('mouseleave', scheduleHoverClose);

function applyPowerFocus() {
  powerMenuItems.forEach((el, i) => el.classList.toggle('focused', i === powerFocusIndex));
}

function movePowerFocus(delta) {
  clearConfirm();
  powerFocusIndex = Math.max(0, Math.min(powerMenuItems.length - 1, powerFocusIndex + delta));
  applyPowerFocus();
}

function clearConfirm() {
  if (confirmTimeout) clearTimeout(confirmTimeout);
  confirmTimeout = null;
  if (confirmAction) {
    const el = powerMenuItems.find((i) => i.dataset.action === confirmAction);
    if (el) el.classList.remove('confirming');
  }
  confirmAction = null;
}

async function activatePowerItem() {
  const el = powerMenuItems[powerFocusIndex];
  const action = el.dataset.action;

  if (action === 'exit') {
    // Non-destructive — no confirmation needed.
    const result = await window.launcher.powerAction(action);
    if (!result.ok) reportError('power-exit', result.error);
    closePowerMenu();
    return;
  }

  // Shutdown / restart require a second press within 4s.
  if (confirmAction === action) {
    clearConfirm();
    closePowerMenu();
    const result = await window.launcher.powerAction(action);
    if (!result.ok) reportError(`power-${action}`, result.error);
    return;
  }

  clearConfirm();
  confirmAction = action;
  el.classList.add('confirming');
  confirmTimeout = setTimeout(clearConfirm, 4000);
}

// Click still opens it (needed for touch, or anyone not hovering) —
// hover/mouseleave/Backspace/B button remain the ways to close it.
powerBtn.addEventListener('click', openPowerMenu);
powerMenuItems.forEach((el, i) => {
  el.addEventListener('click', () => {
    powerFocusIndex = i;
    applyPowerFocus();
    activatePowerItem();
  });
});
document.addEventListener('click', (e) => {
  if (powerMenuOpen && !powerMenu.contains(e.target) && e.target !== powerBtn) {
    closePowerMenu();
  }
});

// ---------- Keyboard navigation ----------
document.addEventListener('keydown', (e) => {
  if (volumeOpen) {
    switch (e.key) {
      case 'ArrowLeft': adjustVolume(-VOLUME_STEP); return;
      case 'ArrowRight': adjustVolume(VOLUME_STEP); return;
      case 'Escape': case 'Backspace': closeVolume(); return;
      case 'Enter': closeVolume(); return;
      default: return; // swallow everything else while it owns input
    }
  }
  if (keyboardOpen) {
    if (e.key === 'Escape') { closeKeyboard(); return; }
    if (e.key === 'Enter') { submitSearch(); return; }
    if (e.key === 'Backspace') { backspaceQuery(); return; }
    switch (e.key) {
      case 'ArrowUp': moveFocus(-1, 0); return;
      case 'ArrowDown': moveFocus(1, 0); return;
      case 'ArrowLeft': moveFocus(0, -1); return;
      case 'ArrowRight': moveFocus(0, 1); return;
    }
    // A physical keyboard can just type directly — no need to click
    // through the on-screen keys letter by letter.
    if (e.key.length === 1) { appendQueryChar(e.key); }
    return;
  }
  if (powerMenuOpen) {
    switch (e.key) {
      case 'ArrowUp': movePowerFocus(-1); break;
      case 'ArrowDown': movePowerFocus(1); break;
      case 'Enter': activatePowerItem(); break;
      case 'Backspace': closePowerMenu(); break;
    }
    return;
  }
  switch (e.key) {
    case 'ArrowUp': moveFocus(-1, 0); break;
    case 'ArrowDown': moveFocus(1, 0); break;
    case 'ArrowLeft': moveFocus(0, -1); break;
    case 'ArrowRight': moveFocus(0, 1); break;
    case 'Enter': activateFocused(); break;
    case 'Backspace': goBack(); break;
    case 'p': case 'P': openPowerMenu(); break;
    case 's': case 'S': window.launcher.powerAction('settings'); break;
    case ' ': spotifyToggle(); break;
    case '[': spotifyPrevious(); break;
    case ']': spotifyNext(); break;
    case 'x': case 'X': contextActionFocused(); break;
    case 'v': case 'V': openVolume(); break;
  }
});

// ---------- Gamepad navigation (8BitDo in XInput mode = standard mapping) ----------
const AXIS_THRESHOLD = 0.5;
const REPEAT_MS = 220;
let lastMoveAt = 0;
let lastButtonState = {};

function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = pads[0];
  const statusEl = document.getElementById('pad-status');

  // The Gamepad API keeps reporting input regardless of which window the
  // user is actually looking at, so without this check the launcher keeps
  // navigating underneath a launched app — you'd move through Moonlight's
  // menu and CouchUI's tile grid at the same time. Apps that take focus
  // properly (Kodi) hid the bug; ones that don't, exposed it.
  if (!document.hasFocus()) {
    // Drop the button state so a button still held when focus returns
    // isn't read as a fresh press.
    lastButtonState = {};
    if (pad) {
      statusEl.textContent = 'Controller handed to the running app';
      statusEl.classList.remove('connected');
    }
    requestAnimationFrame(pollGamepad);
    return;
  }

  if (!pad) {
    statusEl.textContent = 'No controller detected';
    statusEl.classList.remove('connected');
    requestAnimationFrame(pollGamepad);
    return;
  }

  statusEl.textContent = `Connected: ${pad.id.slice(0, 40)}`;
  statusEl.classList.add('connected');

  const now = Date.now();
  const dpadUp = pad.buttons[12]?.pressed;
  const dpadDown = pad.buttons[13]?.pressed;
  const dpadLeft = pad.buttons[14]?.pressed;
  const dpadRight = pad.buttons[15]?.pressed;

  const stickX = pad.axes[0] || 0;
  const stickY = pad.axes[1] || 0;

  const up = dpadUp || stickY < -AXIS_THRESHOLD;
  const down = dpadDown || stickY > AXIS_THRESHOLD;
  const left = dpadLeft || stickX < -AXIS_THRESHOLD;
  const right = dpadRight || stickX > AXIS_THRESHOLD;

  if (volumeOpen) {
    if (now - lastMoveAt > REPEAT_MS) {
      if (left) { adjustVolume(-VOLUME_STEP); lastMoveAt = now; }
      else if (right) { adjustVolume(VOLUME_STEP); lastMoveAt = now; }
    }
    // B closes; everything else is ignored so a stray press can't launch
    // something while the popup has focus.
    const bNow = pad.buttons[1]?.pressed;
    if (bNow && !lastButtonState[1]) closeVolume();
    lastButtonState[1] = bNow;
    requestAnimationFrame(pollGamepad);
    return;
  }

  if (now - lastMoveAt > REPEAT_MS) {
    if (keyboardOpen) {
      if (up) { moveFocus(-1, 0); lastMoveAt = now; }
      else if (down) { moveFocus(1, 0); lastMoveAt = now; }
      else if (left) { moveFocus(0, -1); lastMoveAt = now; }
      else if (right) { moveFocus(0, 1); lastMoveAt = now; }
    } else if (powerMenuOpen) {
      if (up) { movePowerFocus(-1); lastMoveAt = now; }
      else if (down) { movePowerFocus(1); lastMoveAt = now; }
    } else {
      if (up) { moveFocus(-1, 0); lastMoveAt = now; }
      else if (down) { moveFocus(1, 0); lastMoveAt = now; }
      else if (left) { moveFocus(0, -1); lastMoveAt = now; }
      else if (right) { moveFocus(0, 1); lastMoveAt = now; }
    }
  }

  // Standard mapping: 0 = A, 1 = B, 2 = X, 3 = Y, 4 = LB, 5 = RB, 9 = Start
  const aPressed = pad.buttons[0]?.pressed;
  const bPressed = pad.buttons[1]?.pressed;
  const xPressed = pad.buttons[2]?.pressed;
  const yPressed = pad.buttons[3]?.pressed;
  const lbPressed = pad.buttons[4]?.pressed;
  const rbPressed = pad.buttons[5]?.pressed;
  const startPressed = pad.buttons[9]?.pressed;

  if (aPressed && !lastButtonState[0]) {
    if (powerMenuOpen) activatePowerItem();
    else activateFocused();
  }
  if (bPressed && !lastButtonState[1]) {
    if (keyboardOpen) closeKeyboard();
    else if (powerMenuOpen) closePowerMenu();
    else goBack();
  }
  if (!powerMenuOpen && !keyboardOpen && xPressed && !lastButtonState[2]) contextActionFocused();
  if (!powerMenuOpen && !keyboardOpen && yPressed && !lastButtonState[3]) spotifyToggle();
  if (!powerMenuOpen && !keyboardOpen && lbPressed && !lastButtonState[4]) spotifyPrevious();
  if (!powerMenuOpen && !keyboardOpen && rbPressed && !lastButtonState[5]) spotifyNext();
  if (!keyboardOpen && startPressed && !lastButtonState[9]) {
    togglePowerMenu();
  }

  lastButtonState[0] = aPressed;
  lastButtonState[1] = bPressed;
  lastButtonState[2] = xPressed;
  lastButtonState[3] = yPressed;
  lastButtonState[4] = lbPressed;
  lastButtonState[5] = rbPressed;
  lastButtonState[9] = startPressed;

  requestAnimationFrame(pollGamepad);
}

window.addEventListener('gamepadconnected', () => console.log('Gamepad connected'));
requestAnimationFrame(pollGamepad);

// ---------- Now Playing bar (Spotify) ----------
const nowPlayingEl = document.getElementById('now-playing');
const npArt = document.getElementById('now-playing-art');
const npTrack = document.getElementById('now-playing-track');
const npArtist = document.getElementById('now-playing-artist');
const npProgressFill = document.getElementById('np-progress-fill');
const npToggleBtn = document.getElementById('np-toggle');
const npShuffleBtn = document.getElementById('np-shuffle');
let shuffleOn = true;

// Fades out this many ms after playback is paused, so a pause registers
// visually before the bar drops away rather than vanishing instantly.
const NOW_PLAYING_HIDE_DELAY_MS = 6000;
let nowPlayingHideTimer = null;

function hideNowPlayingNow() {
  clearTimeout(nowPlayingHideTimer);
  nowPlayingHideTimer = null;
  nowPlayingEl.classList.remove('visible');
}

async function refreshNowPlaying() {
  const authResult = await window.launcher.spotify.isAuthed();
  if (!authResult.authed) {
    hideNowPlayingNow();
    return;
  }
  const state = await window.launcher.spotify.getState();
  if (!state.ok || !state.active) {
    hideNowPlayingNow();
    return;
  }

  const wasVisible = nowPlayingEl.classList.contains('visible');
  if (!state.isPlaying && !wasVisible) {
    // Paused, and the bar has already faded out — a background poll
    // shouldn't bring it back just because nothing changed.
    return;
  }

  npTrack.textContent = state.trackName;
  npArtist.textContent = state.artistName;
  npArt.src = state.albumArt || '';
  // Shows what pressing the button will do next: a pause icon means it's
  // currently playing (press to pause), a play icon means it's paused.
  npToggleBtn.textContent = state.isPlaying ? '⏸' : '▶';
  shuffleOn = !!state.shuffle;
  npShuffleBtn.classList.toggle('active', shuffleOn);
  const progressRatio = state.durationMs ? Math.min(1, state.progressMs / state.durationMs) : 0;
  npProgressFill.style.transform = `scaleX(${progressRatio})`;
  if (state.volume != null) currentVolume = state.volume;
  nowPlayingEl.classList.add('visible');

  clearTimeout(nowPlayingHideTimer);
  nowPlayingHideTimer = state.isPlaying
    ? null
    : setTimeout(hideNowPlayingNow, NOW_PLAYING_HIDE_DELAY_MS);
}

// ---------- Volume popup ----------
// Opens above the Now Playing bar and captures input, so left/right adjust
// volume instead of moving tile focus. Closes on B/Escape, or after
// VOLUME_TIMEOUT_MS of no adjustment — the timer resets on every change so
// it can't close out from under you mid-adjustment.
const VOLUME_TIMEOUT_MS = 10000;
const VOLUME_STEP = 5;

const volumePopup = document.getElementById('volume-popup');
const volumeFill = document.getElementById('volume-fill');
const volumeValue = document.getElementById('volume-value');
const volumeIconEl = document.getElementById('volume-icon');

let currentVolume = 50;
let volumeTimer = null;
let volumePushTimer = null;

function renderVolume() {
  volumeFill.style.transform = `scaleX(${currentVolume / 100})`;
  volumeValue.textContent = `${currentVolume}%`;
  volumeIconEl.textContent = currentVolume === 0 ? '🔇' : currentVolume < 40 ? '🔉' : '🔊';
}

function armVolumeTimeout() {
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(closeVolume, VOLUME_TIMEOUT_MS);
}

async function openVolume() {
  if (!nowPlayingEl.classList.contains('visible')) return;
  // Read the device's real level first so the popup doesn't open showing a
  // stale value and then jump.
  const state = await window.launcher.spotify.getState();
  if (state.ok && state.volume != null) currentVolume = state.volume;

  volumeOpen = true;
  renderVolume();
  volumePopup.classList.add('visible');
  armVolumeTimeout();
}

function closeVolume() {
  clearTimeout(volumeTimer);
  volumeTimer = null;
  volumeOpen = false;
  volumePopup.classList.remove('visible');
}

function adjustVolume(delta) {
  currentVolume = Math.max(0, Math.min(100, currentVolume + delta));
  renderVolume();
  armVolumeTimeout();

  // Held input would otherwise fire an API call per step; send only the
  // level you settled on.
  clearTimeout(volumePushTimer);
  volumePushTimer = setTimeout(async () => {
    const result = await window.launcher.spotify.setVolume(currentVolume);
    if (!result.ok) reportError('spotify-volume', result.error);
  }, 250);
}

async function spotifyShuffle() {
  const next = !shuffleOn;
  const result = await window.launcher.spotify.setShuffle(next);
  if (!result.ok) {
    reportError('spotify-shuffle', result.error);
    return;
  }
  shuffleOn = next;
  npShuffleBtn.classList.toggle('active', shuffleOn);
}

// Adds to the up-next queue instead of interrupting what's playing —
// the "queue this" behaviour you'd expect from a music app.
async function queueFocused() {
  const idx = grid[focusRow]?.[focusCol];
  if (idx == null) return;
  const tile = tileEls[idx];
  if (!tile?.trackUri) return;
  tile.el.classList.add('launching');
  const result = await window.launcher.spotify.queue(tile.trackUri);
  setTimeout(() => tile.el.classList.remove('launching'), 500);
  if (!result.ok) reportError('spotify-queue', result.error);
}

async function spotifyToggle() {
  const result = await window.launcher.spotify.toggle();
  if (!result.ok) reportError('spotify-control', result.error);
  else setTimeout(refreshNowPlaying, 300);
}

async function spotifyNext() {
  const result = await window.launcher.spotify.next();
  if (!result.ok) reportError('spotify-control', result.error);
  else setTimeout(refreshNowPlaying, 300);
}

async function spotifyPrevious() {
  const result = await window.launcher.spotify.previous();
  if (!result.ok) reportError('spotify-control', result.error);
  else setTimeout(refreshNowPlaying, 300);
}

document.getElementById('np-toggle').addEventListener('click', spotifyToggle);
document.getElementById('np-shuffle').addEventListener('click', spotifyShuffle);
document.getElementById('np-volume').addEventListener('click', openVolume);
document.getElementById('np-next').addEventListener('click', spotifyNext);
document.getElementById('np-prev').addEventListener('click', spotifyPrevious);

setInterval(refreshNowPlaying, 8000);

// ---------- Theme, background, and font (set from the Settings window) ----------
const bgLayers = [document.getElementById('bg-layer-a'), document.getElementById('bg-layer-b')];
let bgActiveLayer = 0;
let bgSlideshowTimer = null;

function stopSlideshow() {
  clearInterval(bgSlideshowTimer);
  bgSlideshowTimer = null;
}

function showBackgroundImage(imagePath) {
  const nextLayer = bgLayers[1 - bgActiveLayer];
  const curLayer = bgLayers[bgActiveLayer];
  nextLayer.style.backgroundImage = `url("file://${imagePath}")`;
  nextLayer.style.opacity = '1';
  curLayer.style.opacity = '0';
  bgActiveLayer = 1 - bgActiveLayer;

  // Re-measure text contrast for this specific image. Runs per image (so a
  // slideshow re-evaluates on each change), never per frame.
  sampleBackgroundImage(imagePath).then(applySampledBackgroundText);
}

function applyBackground(background) {
  stopSlideshow();
  document.body.classList.remove('has-custom-bg');
  document.body.style.backgroundColor = '';
  bgLayers.forEach((l) => {
    l.style.opacity = '0';
    l.style.backgroundImage = '';
  });
  // Any previously sampled per-region colors belong to an image that's no
  // longer showing — clear them so they can't leak into color/theme mode.
  applySampledBackgroundText(null);

  if (background.mode === 'color' && background.color) {
    document.body.classList.add('has-custom-bg');
    document.body.style.backgroundColor = background.color;
    return;
  }

  // 'image' mode is just a one-picture slideshow — same crossfade layers,
  // just nothing to rotate to.
  const images = background.mode === 'slideshow'
    ? background.slideshow.images
    : background.mode === 'image' && background.image ? [background.image] : [];

  if (!images.length) return; // 'theme' mode, or nothing configured yet

  document.body.classList.add('has-custom-bg');
  document.documentElement.style.setProperty('--bg-fade-duration', `${background.slideshow.fadeSeconds ?? 2}s`);
  showBackgroundImage(images[0]);

  if (images.length > 1) {
    let index = 0;
    const intervalMs = Math.max(1, background.slideshow.intervalSeconds || 15) * 1000;
    bgSlideshowTimer = setInterval(() => {
      index = (index + 1) % images.length;
      showBackgroundImage(images[index]);
    }, intervalMs);
  }
}

const SHIPPED_FONT_STACKS = {
  roboto: "'CL Roboto', sans-serif",
  'open-sans': "'CL Open Sans', sans-serif",
  merriweather: "'CL Merriweather', serif",
  'jetbrains-mono': "'CL JetBrains Mono', monospace",
};

function hexToRgba(hex, opacityPercent) {
  const clean = (hex || '').replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;
  const a = Math.max(0, Math.min(100, opacityPercent)) / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// WCAG relative luminance, used to pick a readable text color for whatever
// solid background color is chosen — a fixed light/dark text color can't
// stay readable against an arbitrary color, but this can.
function relativeLuminance(hex) {
  const clean = (hex || '').replace('#', '');
  const channel = (i) => {
    const c = (parseInt(clean.substring(i, i + 2), 16) || 0) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

// The luminance at which black and white text give exactly equal contrast.
// Solving (1.05)/(L+0.05) = (L+0.05)/0.05 gives L = sqrt(0.0525) - 0.05.
// Above this, black text wins; below it, white does. Worth deriving rather
// than eyeballing: an intuitive-looking 0.4 is badly wrong — it picks white
// text on a mid-gray background (3.95:1) when black would give 5.32:1.
const TEXT_COLOR_CROSSOVER = Math.sqrt(0.0525) - 0.05; // ≈ 0.179

function autoContrastTextHex(bgHex) {
  return relativeLuminance(bgHex) > TEXT_COLOR_CROSSOVER ? '#14161C' : '#F2EFE9';
}

// ---------- Background image sampling (adaptive text color) ----------
// Text sits in three fixed corners of the screen, so a single average over
// the whole image is the wrong measure — a photo that's dark sky on top and
// bright sand at the bottom averages to a mid-gray that suits neither the
// clock nor the footer hints. Instead each region is sampled separately and
// gets its own contrast decision.
//
// Cost is negligible: the image is drawn once to a 32x32 off-screen canvas
// (the downscale is hardware-accelerated), and we average ~1000 pixels —
// sub-millisecond, and it runs once per image load, not per frame.
const BG_SAMPLE_SIZE = 32;

// Fractional (x, y, w, h) boxes matching where each group of text actually
// sits, so we measure what's behind the text rather than the whole picture.
const BG_SAMPLE_REGIONS = {
  topLeft: [0, 0, 0.45, 0.25],      // clock + date
  topRight: [0.55, 0, 0.45, 0.25],   // weather
  bottom: [0, 0.82, 1, 0.18],         // footer hint legend
};

// At the crossover above, whichever color we pick still gets ~4.58:1, which
// clears WCAG AA — so a *flat* background is never genuinely unreadable.
// The real problem is a busy region (half dark, half bright), where the
// average is misleading and neither color works across the whole area.
// High spread is the signal for that, so that's what we measure.
const BG_HIGH_VARIANCE = 0.12; // stddev of per-pixel luminance

function sampleRegion(pixels, canvasSize, [fx, fy, fw, fh]) {
  const x0 = Math.floor(fx * canvasSize);
  const y0 = Math.floor(fy * canvasSize);
  const x1 = Math.min(canvasSize, Math.ceil((fx + fw) * canvasSize));
  const y1 = Math.min(canvasSize, Math.ceil((fy + fh) * canvasSize));

  const toLinear = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  const lums = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * canvasSize + x) * 4;
      lums.push(0.2126 * toLinear(pixels[i]) + 0.7152 * toLinear(pixels[i + 1]) + 0.0722 * toLinear(pixels[i + 2]));
    }
  }
  if (!lums.length) return { mean: 0, stdDev: 0 };

  const mean = lums.reduce((a, b) => a + b, 0) / lums.length;
  const variance = lums.reduce((acc, l) => acc + (l - mean) ** 2, 0) / lums.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

// Resolves to { topLeft, topRight, bottom } of { textHex, uncertain },
// or null if the image can't be read (missing file, decode failure) — in
// which case the caller just leaves the theme's own colors alone.
function sampleBackgroundImage(imagePath) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = BG_SAMPLE_SIZE;
        canvas.height = BG_SAMPLE_SIZE;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, BG_SAMPLE_SIZE, BG_SAMPLE_SIZE);
        const { data } = ctx.getImageData(0, 0, BG_SAMPLE_SIZE, BG_SAMPLE_SIZE);

        const result = {};
        for (const [name, box] of Object.entries(BG_SAMPLE_REGIONS)) {
          const { mean, stdDev } = sampleRegion(data, BG_SAMPLE_SIZE, box);
          result[name] = {
            textHex: mean > TEXT_COLOR_CROSSOVER ? '#14161C' : '#F2EFE9',
            uncertain: stdDev > BG_HIGH_VARIANCE,
          };
        }
        resolve(result);
      } catch (err) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = `file://${imagePath}`;
  });
}

// Pushes sampled per-region colors into the CSS variables the
// background-sitting text reads from (see theme.css / style.css).
function applySampledBackgroundText(sample) {
  const root = document.documentElement;
  const regionVars = {
    topLeft: '--bg-text-topleft',
    topRight: '--bg-text-topright',
    bottom: '--bg-text-bottom',
  };

  if (!sample) {
    Object.values(regionVars).forEach((v) => {
      root.style.removeProperty(v);
      root.style.removeProperty(`${v}-dim`);
    });
    document.body.classList.remove('bg-uncertain-topleft', 'bg-uncertain-topright', 'bg-uncertain-bottom');
    return;
  }

  for (const [name, varName] of Object.entries(regionVars)) {
    const { textHex, uncertain } = sample[name];
    root.style.setProperty(varName, hexToRgba(textHex, 100));
    root.style.setProperty(`${varName}-dim`, hexToRgba(textHex, 72));
    document.body.classList.toggle(
      `bg-uncertain-${name.toLowerCase()}`,
      uncertain
    );
  }
}

// Minimum contrast a text color needs against a background before it's
// trusted — below this it's treated the same as not having set a color at
// all. This is what stops an explicit font color chosen against one
// background (or one theme) from silently making text unreadable after
// switching to a background/theme it was never actually checked against.
const MIN_TEXT_CONTRAST = 3;

let customFontStyleEl = null;

// autoTextHex: when set (solid-color background, no explicit font color
// chosen), used as the text color's base instead of the theme default —
// so clock/date/weather/hints text stays readable no matter which solid
// color preset is picked, without needing the user to also pick a font
// color by hand.
function applyFont(font, autoTextHex) {
  const root = document.documentElement;

  // Family — 'system' (default) leaves --user-font-family unset, which
  // falls back to the existing font stack, so nothing changes by default.
  if (font.family === 'custom' && font.customPath && font.customName) {
    if (!customFontStyleEl) {
      customFontStyleEl = document.createElement('style');
      customFontStyleEl.id = 'custom-font-face';
      document.head.appendChild(customFontStyleEl);
    }
    customFontStyleEl.textContent = `@font-face { font-family: '${font.customName}'; src: url("file://${font.customPath}"); }`;
    root.style.setProperty('--user-font-family', `'${font.customName}'`);
  } else {
    if (customFontStyleEl) customFontStyleEl.textContent = '';
    const stack = SHIPPED_FONT_STACKS[font.family];
    if (stack) root.style.setProperty('--user-font-family', stack);
    else root.style.removeProperty('--user-font-family');
  }

  // Size — percent scale multiplied into every font-size in style.css.
  root.style.setProperty('--user-font-scale', String((font.scale || 100) / 100));

  // Explicit font color + opacity (Settings → Appearance → Font). Only
  // applies if it actually contrasts against both the tile surface and
  // the page background — this is what makes switching theme (or a color
  // you set once against a different background) unable to leave you
  // with invisible text. Feeds --user-text-color, which only --text/
  // --text-dim read from — i.e. tiles, buttons, the power menu: anything
  // sitting on its own opaque --surface panel, which stays the same
  // regardless of any custom page background.
  const opacity = font.opacity ?? 100;
  const surfaceHex = getComputedStyle(root).getPropertyValue('--surface').trim() || '#FFFFFF';
  const bgHex = getComputedStyle(root).getPropertyValue('--bg').trim() || '#14161C';
  const themeHex = getComputedStyle(root).getPropertyValue('--text-theme').trim() || '#F2EFE9';

  const explicitColorIsReadable = font.color
    && contrastRatio(font.color, surfaceHex) >= MIN_TEXT_CONTRAST
    && contrastRatio(font.color, bgHex) >= MIN_TEXT_CONTRAST;

  let baseHex = null;
  if (explicitColorIsReadable) baseHex = font.color;
  else if (opacity < 100) baseHex = themeHex;

  if (baseHex) {
    root.style.setProperty('--user-text-color', hexToRgba(baseHex, opacity));
    root.style.setProperty('--user-text-dim-color', hexToRgba(baseHex, opacity * 0.65));
  } else {
    root.style.removeProperty('--user-text-color');
    root.style.removeProperty('--user-text-dim-color');
  }

  // Solid-background auto-contrast (autoTextHex, from applyAppSettings).
  // Feeds --bg-auto-text-color, which only --bg-text/--bg-text-dim read
  // from — used only by text sitting directly on the raw page background
  // (clock, weather, footer hints, tile row titles), the only text an
  // arbitrary background color can actually make unreadable. Kept
  // completely separate from --user-text-color above on purpose: those
  // two used to share one variable, which meant this auto-contrast color
  // was incorrectly overriding tile/button text too (it doesn't sit on
  // the page background, it sits on --surface, which is already always
  // theme-consistent regardless of the page background).
  if (autoTextHex) {
    root.style.setProperty('--bg-auto-text-color', hexToRgba(autoTextHex, 100));
    root.style.setProperty('--bg-auto-text-dim-color', hexToRgba(autoTextHex, 70));
  } else {
    root.style.removeProperty('--bg-auto-text-color');
    root.style.removeProperty('--bg-auto-text-dim-color');
  }
}

function applyAppSettings(settings) {
  document.documentElement.setAttribute('data-theme', settings.theme || 'dark');
  const background = settings.background || { mode: 'theme' };
  applyBackground(background);
  const autoTextHex = background.mode === 'color' && background.color
    ? autoContrastTextHex(background.color)
    : null;
  applyFont(settings.font || { family: 'system', scale: 100, opacity: 100 }, autoTextHex);

  if (settings.location) {
    clockSettings = { ...clockSettings, ...settings.location };
    restartClock();
  }
  if (settings.weather) {
    weatherSettings = { ...weatherSettings, ...settings.weather };
    if (appConfig) loadWeather(appConfig);
  }
}

window.launcher.onSettingsUpdated((settings) => applyAppSettings(settings));

// The weather location lives in config.json, so a change there needs to
// refresh the widget too — not just app-settings changes.
window.launcher.onConfigUpdated((config) => {
  appConfig = config;
  loadWeather(appConfig);
});

// ---------- Boot ----------
(async function init() {
  appConfig = await window.launcher.getConfig();
  renderHome();
  loadWeather(appConfig);
  setInterval(() => loadWeather(appConfig), 1000 * 60 * 15); // refresh every 15 min

  const appSettings = await window.launcher.getAppSettings();
  applyAppSettings(appSettings);

  refreshNowPlaying();
})();
