// ---------- Sidebar / pane switching ----------
const navItems = Array.from(document.querySelectorAll('.nav-item'));
const panes = Array.from(document.querySelectorAll('.pane'));

function showPane(name) {
  navItems.forEach((n) => n.classList.toggle('active', n.dataset.pane === name));
  panes.forEach((p) => p.classList.toggle('active', p.id === `pane-${name}`));

  if (name === 'connections') refreshConnections();
  if (name === 'storage') refreshStorage();
  if (name === 'appearance') refreshAppearance();
  if (name === 'updates') refreshUpdates();
  if (name === 'location') refreshLocation();
  if (name === 'weather') refreshWeatherDisplay();
  if (name === 'shortcuts') refreshShortcuts();
  if (name === 'phone') refreshPhone();
}

navItems.forEach((n) => n.addEventListener('click', () => showPane(n.dataset.pane)));

// ---------- Info pane ----------
async function loadInfo() {
  const info = await window.settingsAPI.getSystemInfo();
  if (!info.ok) return;
  document.getElementById('info-ip').textContent = info.ip;
  document.getElementById('info-hostname').textContent = info.hostname;
  document.getElementById('info-cpu').textContent = `${info.cpuModel} (${info.cpuCores} cores)`;
  document.getElementById('info-cpu-usage').textContent = `${info.cpuUsage}%`;
  document.getElementById('info-ram').textContent = `${info.ramUsedGB} GB / ${info.ramTotalGB} GB`;
}

// ---------- Connections pane ----------
let connectionsLoaded = false;

async function refreshConnections() {
  const wifiToggle = document.getElementById('wifi-toggle');
  const btToggle = document.getElementById('bt-toggle');

  const [wifiStatus, btStatus] = await Promise.all([
    window.settingsAPI.wifiStatus(),
    window.settingsAPI.btStatus(),
  ]);
  wifiToggle.checked = !!wifiStatus.enabled;
  btToggle.checked = !!btStatus.enabled;

  if (wifiStatus.enabled) loadWifiList();
  loadBtList();
  if (btStatus.enabled) loadBtConnected();
  else document.getElementById('bt-connected-list').innerHTML =
    '<div class="empty-note">Bluetooth is off.</div>';
  connectionsLoaded = true;
}

document.getElementById('wifi-toggle').addEventListener('change', async (e) => {
  await window.settingsAPI.wifiToggle(e.target.checked);
  if (e.target.checked) loadWifiList();
  else document.getElementById('wifi-list').innerHTML = '';
});

document.getElementById('bt-toggle').addEventListener('change', async (e) => {
  await window.settingsAPI.btToggle(e.target.checked);
});

async function loadWifiList() {
  const container = document.getElementById('wifi-list');
  container.innerHTML = '<div class="empty-note">Scanning…</div>';
  const result = await window.settingsAPI.wifiList();
  if (!result.ok) {
    container.innerHTML = `<div class="empty-note">Couldn't list networks: ${result.error}</div>`;
    return;
  }
  if (!result.networks.length) {
    container.innerHTML = '<div class="empty-note">No networks found.</div>';
    return;
  }
  container.innerHTML = '';
  result.networks.forEach((net) => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <div class="list-row-main">
        <span class="list-row-name ${net.connected ? 'connected' : ''}">${net.ssid}</span>
        <span class="list-row-sub">${net.secured ? 'Secured' : 'Open'} · signal ${net.signal}%</span>
      </div>
    `;
    if (!net.connected) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-small';
      btn.textContent = 'Connect';
      btn.addEventListener('click', () => promptWifiConnect(net, row, btn));
      row.appendChild(btn);
    }
    container.appendChild(row);
  });
}

function promptWifiConnect(net, row, btn) {
  if (!net.secured) {
    connectWifi(net.ssid, '', btn);
    return;
  }
  if (row.querySelector('.pw-row')) return; // already open

  const pwRow = document.createElement('div');
  pwRow.className = 'pw-row';
  pwRow.innerHTML = `
    <input type="password" placeholder="Wi-Fi password" />
    <button class="btn btn-small">Join</button>
  `;
  row.appendChild(pwRow);
  const input = pwRow.querySelector('input');
  const joinBtn = pwRow.querySelector('button');
  input.focus();
  joinBtn.addEventListener('click', () => connectWifi(net.ssid, input.value, joinBtn));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connectWifi(net.ssid, input.value, joinBtn);
  });
}

async function connectWifi(ssid, password, btn) {
  btn.textContent = 'Connecting…';
  btn.disabled = true;
  const result = await window.settingsAPI.wifiConnect(ssid, password);
  if (result.ok) {
    loadWifiList();
  } else {
    btn.textContent = 'Failed';
    btn.disabled = false;
  }
}

// Battery as an icon with a proportional fill, plus the number — the icon
// reads at a glance from the couch, the number when you care about detail.
// Colour shifts at the thresholds where it starts to matter.
function batteryIcon(pct) {
  const fill = Math.max(0, Math.min(100, pct));
  const colour = fill <= 15 ? 'var(--danger)' : fill <= 35 ? 'var(--focus)' : 'var(--safe)';
  // 18 units of internal width, scaled by the charge level.
  const w = Math.max(1, Math.round((fill / 100) * 18));
  return `
    <span class="battery">
      <svg viewBox="0 0 30 14" aria-hidden="true">
        <rect x="0.75" y="0.75" width="24" height="12.5" rx="2.5"
              fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
        <rect x="26.5" y="4.5" width="2.5" height="5" rx="1" fill="currentColor" opacity="0.55"/>
        <rect x="3" y="3" width="${w}" height="8" rx="1.5" fill="${colour}"/>
      </svg>
      <span class="battery-pct">${fill}%</span>
    </span>`;
}

async function loadBtConnected() {
  const container = document.getElementById('bt-connected-list');
  const result = await window.settingsAPI.btConnected();

  if (!result.ok) {
    container.innerHTML = `<div class="empty-note">Couldn't read connected devices: ${result.error}</div>`;
    return;
  }
  if (!result.devices.length) {
    container.innerHTML = '<div class="empty-note">No Bluetooth devices connected.</div>';
    return;
  }

  container.innerHTML = '';
  result.devices.forEach((dev) => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <div class="list-row-main">
        <span class="list-row-name">${dev.name}</span>
        <span class="list-row-sub">${dev.mac}</span>
      </div>
      <div class="device-meta">
        <span class="device-state">Connected</span>
        ${dev.battery == null
          ? '<span class="device-nobatt">No battery info</span>'
          : batteryIcon(dev.battery)}
      </div>
    `;
    const btn = document.createElement('button');
    btn.className = 'btn btn-small btn-secondary';
    btn.textContent = 'Disconnect';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Disconnecting…';
      await window.settingsAPI.btDisconnect(dev.mac);
      loadBtConnected();
    });
    row.appendChild(btn);
    container.appendChild(row);
  });
}

async function loadBtList() {
  const container = document.getElementById('bt-list');
  const result = await window.settingsAPI.btStatus();
  if (!result.enabled) {
    container.innerHTML = '<div class="empty-note">Turn Bluetooth on, then scan.</div>';
    return;
  }
  container.innerHTML = '<div class="empty-note">Press "Scan for devices" to find nearby devices.</div>';
}

document.getElementById('bt-scan-btn').addEventListener('click', async () => {
  const container = document.getElementById('bt-list');
  container.innerHTML = '<div class="empty-note">Scanning (a few seconds)…</div>';
  const result = await window.settingsAPI.btScan();
  if (!result.ok) {
    container.innerHTML = `<div class="empty-note">Scan failed: ${result.error}</div>`;
    return;
  }
  if (!result.devices.length) {
    container.innerHTML = '<div class="empty-note">No devices found.</div>';
    return;
  }
  container.innerHTML = '';
  result.devices.forEach((dev) => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <div class="list-row-main">
        <span class="list-row-name">${dev.name}</span>
        <span class="list-row-sub">${dev.mac}</span>
      </div>
    `;
    const btn = document.createElement('button');
    btn.className = 'btn btn-small';
    btn.textContent = 'Connect';
    btn.addEventListener('click', async () => {
      btn.textContent = 'Connecting…';
      btn.disabled = true;
      const res = await window.settingsAPI.btConnect(dev.mac);
      btn.textContent = res.ok ? 'Connected' : 'Failed';
      btn.disabled = res.ok;
    });
    row.appendChild(btn);
    container.appendChild(row);
  });
});

// ---------- Storage pane ----------
async function refreshStorage() {
  const container = document.getElementById('storage-list');
  container.innerHTML = '<div class="empty-note">Reading storage…</div>';
  const result = await window.settingsAPI.getStorage();
  if (!result.ok) {
    container.innerHTML = `<div class="empty-note">Couldn't read storage: ${result.error}</div>`;
    return;
  }
  if (!result.volumes.length) {
    container.innerHTML = '<div class="empty-note">No volumes found.</div>';
    return;
  }
  container.innerHTML = '';
  result.volumes.forEach((v) => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <div class="list-row-main">
        <span class="list-row-name">${v.target}</span>
        <span class="list-row-sub">${v.source} · ${v.used} used of ${v.size}</span>
      </div>
      <span class="list-row-sub">${v.pcent}</span>
    `;
    container.appendChild(row);
  });
}

// ---------- Appearance pane ----------
const BACKGROUND_COLOR_PRESETS = [
  '#14161C', // near-black
  '#1D2027', // slate
  '#0B3D91', // deep blue
  '#1B4332', // deep green
  '#5C2A9D', // purple
  '#7A2E2E', // deep red
  '#3E3226', // warm brown
  '#EEF0F3', // near-white
];

let currentAppSettings = null;

function buildColorSwatches() {
  const row = document.getElementById('color-swatch-row');
  row.innerHTML = '';
  BACKGROUND_COLOR_PRESETS.forEach((hex) => {
    const btn = document.createElement('button');
    btn.className = 'color-swatch';
    btn.style.background = hex;
    btn.title = hex;
    btn.addEventListener('click', async () => {
      await window.settingsAPI.setBackgroundColor(hex);
      refreshAppearance();
    });
    row.appendChild(btn);
  });
}
buildColorSwatches();

function renderSlideshowList(images) {
  const container = document.getElementById('slideshow-list');
  if (!images.length) {
    container.innerHTML = '<div class="empty-note">No images added yet.</div>';
    return;
  }
  container.innerHTML = '';
  images.forEach((imagePath) => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <div class="list-row-main">
        <span class="list-row-name">${imagePath.split('/').pop()}</span>
        <span class="list-row-sub">${imagePath}</span>
      </div>
    `;
    const btn = document.createElement('button');
    btn.className = 'btn btn-small btn-secondary';
    btn.textContent = 'Remove';
    btn.addEventListener('click', async () => {
      await window.settingsAPI.removeSlideshowImage(imagePath);
      refreshAppearance();
    });
    row.appendChild(btn);
    container.appendChild(row);
  });
}

async function refreshAppearance() {
  const settings = await window.settingsAPI.getAppSettings();
  currentAppSettings = settings;

  document.querySelectorAll('.theme-btn[data-theme]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === settings.theme);
  });

  // Background
  const bg = settings.background;
  document.querySelectorAll('.theme-btn[data-bg-mode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.bgMode === bg.mode);
  });
  document.querySelectorAll('.bg-mode-panel').forEach((panel) => panel.classList.remove('active'));
  const activePanel = document.getElementById(`bg-panel-${bg.mode}`);
  if (activePanel) activePanel.classList.add('active');

  document.querySelectorAll('.color-swatch').forEach((sw) => {
    sw.classList.toggle('active', bg.mode === 'color' && sw.style.background === hexToRgbCss(bg.color));
  });
  document.getElementById('image-path').textContent =
    bg.image ? bg.image : 'No image chosen yet.';
  renderSlideshowList(bg.slideshow.images);
  document.getElementById('slideshow-interval').value = bg.slideshow.intervalSeconds;
  document.getElementById('slideshow-fade').value = bg.slideshow.fadeSeconds;

  // Font
  const font = settings.font;
  document.getElementById('font-family-select').value = font.family;
  document.getElementById('custom-font-name').textContent =
    font.family === 'custom' && font.customName ? `Using: ${font.customName} (${font.customPath})` : '';
  document.getElementById('font-scale').value = font.scale;
  document.getElementById('font-scale-value').textContent = `${font.scale}%`;
  document.getElementById('font-color').value = font.color || '#000000';
  document.getElementById('font-opacity').value = font.opacity;
  document.getElementById('font-opacity-value').textContent = `${font.opacity}%`;
}

// A <button style="background: #HEX"> reads back as an rgb(...) string, not
// the hex — this converts a stored hex the same way so the active-swatch
// comparison above actually matches.
function hexToRgbCss(hex) {
  const clean = (hex || '').replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;
  return `rgb(${r}, ${g}, ${b})`;
}

document.querySelectorAll('.theme-btn[data-theme]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    await window.settingsAPI.setTheme(btn.dataset.theme);
    document.documentElement.setAttribute('data-theme', btn.dataset.theme);
    refreshAppearance();
  });
});

document.querySelectorAll('.theme-btn[data-bg-mode]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const mode = btn.dataset.bgMode;
    if (mode === 'theme') await window.settingsAPI.clearBackground();
    else await window.settingsAPI.setBackground({ mode });
    refreshAppearance();
  });
});

document.getElementById('choose-image-btn').addEventListener('click', async () => {
  const result = await window.settingsAPI.chooseBackgroundImage();
  if (result.ok) refreshAppearance();
});

document.getElementById('add-slideshow-images-btn').addEventListener('click', async () => {
  const result = await window.settingsAPI.chooseSlideshowImages();
  if (result.ok) refreshAppearance();
});

document.getElementById('slideshow-interval').addEventListener('change', async (e) => {
  await window.settingsAPI.setSlideshowTiming({ intervalSeconds: Number(e.target.value) });
});

document.getElementById('slideshow-fade').addEventListener('change', async (e) => {
  await window.settingsAPI.setSlideshowTiming({ fadeSeconds: Number(e.target.value) });
});

document.getElementById('clear-background-btn').addEventListener('click', async () => {
  await window.settingsAPI.clearBackground();
  refreshAppearance();
});

// ---- Font controls ----
document.getElementById('font-family-select').addEventListener('change', async (e) => {
  await window.settingsAPI.setFont({ family: e.target.value });
  refreshAppearance();
});

document.getElementById('upload-font-btn').addEventListener('click', async () => {
  const result = await window.settingsAPI.chooseCustomFont();
  if (result.ok) refreshAppearance();
});

document.getElementById('font-scale').addEventListener('input', (e) => {
  document.getElementById('font-scale-value').textContent = `${e.target.value}%`;
});
document.getElementById('font-scale').addEventListener('change', async (e) => {
  await window.settingsAPI.setFont({ scale: Number(e.target.value) });
});

document.getElementById('font-color').addEventListener('change', async (e) => {
  await window.settingsAPI.setFont({ color: e.target.value });
});
document.getElementById('font-color-reset-btn').addEventListener('click', async () => {
  await window.settingsAPI.setFont({ color: null });
  refreshAppearance();
});

document.getElementById('font-opacity').addEventListener('input', (e) => {
  document.getElementById('font-opacity-value').textContent = `${e.target.value}%`;
});
document.getElementById('font-opacity').addEventListener('change', async (e) => {
  await window.settingsAPI.setFont({ opacity: Number(e.target.value) });
});

// ---------- Updates pane ----------
function formatCheckedAt(iso) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString();
}

async function refreshUpdates() {
  const [settings, version] = await Promise.all([
    window.settingsAPI.getAppSettings(),
    window.settingsAPI.getAppVersion(),
  ]);
  document.getElementById('update-current-version').textContent = version;
  document.getElementById('update-last-checked').textContent = formatCheckedAt(settings.updates.lastChecked);
  document.getElementById('auto-update-toggle').checked = settings.updates.autoCheck;
  document.getElementById('update-status').textContent = '';
}

document.getElementById('check-update-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('update-status');
  const btn = document.getElementById('check-update-btn');
  btn.disabled = true;
  statusEl.textContent = 'Checking…';

  const result = await window.settingsAPI.checkForUpdate();
  btn.disabled = false;

  if (!result.ok) {
    statusEl.textContent = `Couldn't check for updates: ${result.error}`;
  } else if (!result.configured) {
    statusEl.textContent = "Update checking isn't set up yet.";
  } else if (result.updateAvailable) {
    statusEl.textContent = `Update available: v${result.latestVersion}`;
  } else {
    statusEl.textContent = "You're on the latest version.";
  }

  if (result.ok) {
    document.getElementById('update-last-checked').textContent = formatCheckedAt(result.checkedAt);
  }
});

document.getElementById('auto-update-toggle').addEventListener('change', async (e) => {
  await window.settingsAPI.setAutoUpdate(e.target.checked);
});

// ---------- Location pane ----------
// A reusable filtered picker. Options can be filtered locally (a fixed
// list, like time zones) or come back already filtered from an API (city
// search), in which case filtering again locally would just throw the
// results away.
function setupCombo(inputEl, listEl, { getOptions, onPick, minChars = 0, filterLocally = true }) {
  let options = [];
  let loadError = null;

  function render(filter) {
    const q = filter.trim().toLowerCase();
    if (q.length < minChars) {
      listEl.classList.remove('open');
      return;
    }
    const matches = (filterLocally
      ? options.filter((o) => o.search.toLowerCase().includes(q))
      : options
    ).slice(0, 60);

    listEl.innerHTML = '';
    if (loadError) {
      // A failed lookup and a genuine no-such-place look identical
      // otherwise, which sends you hunting for the wrong problem.
      listEl.innerHTML = `<div class="combo-empty">Couldn't search: ${loadError}</div>`;
      listEl.classList.add('open');
      return;
    }
    if (!matches.length) {
      listEl.innerHTML = '<div class="combo-empty">No matches.</div>';
      listEl.classList.add('open');
      return;
    }
    matches.forEach((o) => {
      const el = document.createElement('div');
      el.className = 'combo-option';
      el.innerHTML = o.sub
        ? `${o.label}<span class="combo-option-sub">${o.sub}</span>`
        : o.label;
      el.addEventListener('mousedown', (e) => {
        // mousedown, not click — blur would close the list first.
        e.preventDefault();
        inputEl.value = '';
        listEl.classList.remove('open');
        onPick(o.value);
      });
      listEl.appendChild(el);
    });
    listEl.classList.add('open');
  }

  async function reload() {
    try {
      loadError = null;
      options = await getOptions(inputEl.value);
    } catch (err) {
      loadError = err.message;
      options = [];
    }
    render(inputEl.value);
  }

  inputEl.addEventListener('input', reload);
  inputEl.addEventListener('focus', reload);
  inputEl.addEventListener('blur', () => {
    setTimeout(() => listEl.classList.remove('open'), 120);
  });
}

let cachedTimezones = null;

function describeZone(zone) {
  // Show each zone's current offset so "which Auckland is this" is obvious.
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: zone, timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value || '';
  } catch (err) {
    return '';
  }
}

setupCombo(
  document.getElementById('tz-search'),
  document.getElementById('tz-list'),
  {
    async getOptions() {
      if (!cachedTimezones) {
        const result = await window.settingsAPI.listTimezones();
        cachedTimezones = [
          { value: 'system', label: 'System default', sub: 'Follow the OS setting', search: 'system default' },
          ...result.zones.map((z) => ({
            value: z,
            label: z.replace(/_/g, ' '),
            sub: describeZone(z),
            search: z.replace(/_/g, ' '),
          })),
        ];
      }
      return cachedTimezones;
    },
    async onPick(zone) {
      await window.settingsAPI.setLocation({ timeZone: zone });
      refreshLocation();
    },
  }
);

setupCombo(
  document.getElementById('city-search'),
  document.getElementById('city-list'),
  {
    minChars: 2,
    // Open-Meteo has already matched against the query — filtering again
    // here would discard every result.
    filterLocally: false,
    async getOptions(query) {
      const q = query.trim();
      if (q.length < 2) return [];
      // Fetched here in the renderer, not via IPC to the main process:
      // this runs on Chromium's network stack, which is the one that
      // actually works (see the note in main.js).
      const url = `https://geocoding-api.open-meteo.com/v1/search`
        + `?name=${encodeURIComponent(q)}&count=8&language=en&format=json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`geocoding returned ${res.status}`);
      const data = await res.json();
      return (data.results || []).map((r) => ({
        value: {
          latitude: r.latitude,
          longitude: r.longitude,
          name: r.name,
          timeZone: r.timezone || null,
        },
        label: r.name,
        sub: [r.admin1, r.country].filter(Boolean).join(', '),
      }));
    },
    async onPick(place) {
      await window.settingsAPI.setWeatherLocation({
        latitude: place.latitude,
        longitude: place.longitude,
        locationName: place.name,
      });
      // A city implies its zone — offer that rather than making them
      // set the same thing twice in two places.
      if (place.timeZone) {
        await window.settingsAPI.setLocation({ timeZone: place.timeZone });
      }
      refreshLocation();
    },
  }
);

async function refreshLocation() {
  const [settings, config] = await Promise.all([
    window.settingsAPI.getAppSettings(),
    window.settingsAPI.getConfig(),
  ]);
  const { timeZone, clockFormat, showSeconds } = settings.location;

  const zoneLabel = timeZone === 'system'
    ? `System default (${Intl.DateTimeFormat().resolvedOptions().timeZone})`
    : `${timeZone.replace(/_/g, ' ')} — ${describeZone(timeZone)}`;
  document.getElementById('tz-current').textContent = `Currently: ${zoneLabel}`;

  document.getElementById('clock-format').value = clockFormat;
  document.getElementById('clock-seconds').checked = showSeconds;

  const w = config.weather || {};
  document.getElementById('city-current').textContent = w.locationName
    ? `Currently: ${w.locationName} (${Number(w.latitude).toFixed(2)}, ${Number(w.longitude).toFixed(2)})`
    : 'No weather location set.';
}

document.getElementById('clock-format').addEventListener('change', async (e) => {
  await window.settingsAPI.setLocation({ clockFormat: e.target.value });
});
document.getElementById('clock-seconds').addEventListener('change', async (e) => {
  await window.settingsAPI.setLocation({ showSeconds: e.target.checked });
});

// ---------- Weather widget pane ----------
async function refreshWeatherDisplay() {
  const settings = await window.settingsAPI.getAppSettings();
  const w = settings.weather;

  document.querySelectorAll('[data-weather-style]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.weatherStyle === w.style);
  });
  document.querySelectorAll('[data-weather-units]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.weatherUnits === w.units);
  });
  document.querySelectorAll('[data-weather-field]').forEach((cb) => {
    cb.checked = !!w[cb.dataset.weatherField];
    // Minimal style shows temperature only, so the field toggles have no
    // effect there — disable rather than silently ignore them.
    cb.disabled = w.style === 'minimal';
  });
  document.getElementById('weather-fields-note').textContent =
    w.style === 'minimal'
      ? 'Minimal style shows the temperature only — these have no effect.'
      : 'Choose what appears alongside the temperature.';
}

document.querySelectorAll('[data-weather-style]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    await window.settingsAPI.setWeatherDisplay({ style: btn.dataset.weatherStyle });
    refreshWeatherDisplay();
  });
});
document.querySelectorAll('[data-weather-units]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    await window.settingsAPI.setWeatherDisplay({ units: btn.dataset.weatherUnits });
    refreshWeatherDisplay();
  });
});
document.querySelectorAll('[data-weather-field]').forEach((cb) => {
  cb.addEventListener('change', async () => {
    await window.settingsAPI.setWeatherDisplay({ [cb.dataset.weatherField]: cb.checked });
  });
});

// ---------- Phone remote (KDE Connect) ----------
async function refreshPhone() {
  const status = await window.settingsAPI.kdeconnectStatus();
  const missing = document.getElementById('kde-missing');
  const main = document.getElementById('kde-main');
  const help = document.getElementById('kde-help');

  // Not installed is a normal first-run state, not an error — show what to
  // do about it rather than a failure message.
  missing.style.display = status.installed ? 'none' : '';
  main.style.display = status.installed ? '' : 'none';
  help.style.display = status.installed ? '' : 'none';
  if (!status.installed) return;

  loadKdeDevices();
}

async function loadKdeDevices() {
  const container = document.getElementById('kde-list');
  const result = await window.settingsAPI.kdeconnectDevices();

  if (!result.ok) {
    container.innerHTML = `<div class="empty-note">Couldn't list devices: ${result.error}</div>`;
    return;
  }
  if (!result.devices.length) {
    container.innerHTML = '<div class="empty-note">No devices seen yet. Open KDE Connect on your phone (same Wi-Fi), then press "Search for devices".</div>';
    return;
  }

  container.innerHTML = '';
  result.devices.forEach((dev) => {
    const row = document.createElement('div');
    row.className = 'list-row';
    const state = dev.paired
      ? (dev.reachable ? 'Paired · connected' : 'Paired · not on this network')
      : 'Not paired';
    row.innerHTML = `
      <div class="list-row-main">
        <span class="list-row-name${dev.paired && dev.reachable ? ' connected' : ''}">${dev.name}</span>
        <span class="list-row-sub">${state}</span>
      </div>
    `;

    const statusEl = document.getElementById('kde-status');

    if (dev.paired) {
      const ping = document.createElement('button');
      ping.className = 'btn btn-small';
      ping.textContent = 'Test';
      ping.disabled = !dev.reachable;
      ping.addEventListener('click', async () => {
        statusEl.textContent = `Pinging ${dev.name}…`;
        const res = await window.settingsAPI.kdeconnectPing(dev.id);
        statusEl.textContent = res.ok
          ? `Sent a notification to ${dev.name}.`
          : `Ping failed: ${res.error}`;
      });
      row.appendChild(ping);

      const unpair = document.createElement('button');
      unpair.className = 'btn btn-small btn-secondary';
      unpair.textContent = 'Unpair';
      let armed = false;
      unpair.addEventListener('click', async () => {
        if (!armed) {
          armed = true;
          unpair.textContent = 'Sure?';
          setTimeout(() => { armed = false; unpair.textContent = 'Unpair'; }, 3000);
          return;
        }
        await window.settingsAPI.kdeconnectUnpair(dev.id);
        loadKdeDevices();
      });
      row.appendChild(unpair);
    } else {
      const pair = document.createElement('button');
      pair.className = 'btn btn-small';
      pair.textContent = 'Pair';
      pair.addEventListener('click', async () => {
        pair.disabled = true;
        pair.textContent = 'Pairing…';
        statusEl.textContent = `Accept the pairing request on ${dev.name}.`;
        const res = await window.settingsAPI.kdeconnectPair(dev.id);
        if (!res.ok) statusEl.textContent = `Pairing failed: ${res.error}`;
        loadKdeDevices();
      });
      row.appendChild(pair);
    }

    container.appendChild(row);
  });
}

document.getElementById('kde-refresh-btn').addEventListener('click', async () => {
  const container = document.getElementById('kde-list');
  const statusEl = document.getElementById('kde-status');
  statusEl.textContent = '';
  container.innerHTML = '<div class="empty-note">Searching…</div>';
  await window.settingsAPI.kdeconnectRefresh();
  // The daemon needs a moment to hear back from devices on the network.
  setTimeout(loadKdeDevices, 1500);
});

// ---------- Web shortcuts pane ----------
let editingShortcutId = null;

function shortcutForm() {
  return {
    label: document.getElementById('shortcut-label'),
    url: document.getElementById('shortcut-url'),
    subtitle: document.getElementById('shortcut-subtitle'),
    color: document.getElementById('shortcut-color'),
    status: document.getElementById('shortcut-status'),
    title: document.getElementById('shortcut-form-title'),
    save: document.getElementById('shortcut-save-btn'),
    cancel: document.getElementById('shortcut-cancel-btn'),
  };
}

function resetShortcutForm() {
  const f = shortcutForm();
  editingShortcutId = null;
  f.label.value = '';
  f.url.value = '';
  f.subtitle.value = '';
  f.color.value = '#E8622C';
  f.title.textContent = 'Add a shortcut';
  f.save.textContent = 'Save shortcut';
  f.cancel.style.display = 'none';
  f.status.textContent = '';
}

function editShortcut(sc) {
  const f = shortcutForm();
  editingShortcutId = sc.id;
  f.label.value = sc.label || '';
  f.url.value = sc.url || '';
  f.subtitle.value = sc.subtitle || '';
  f.color.value = sc.color || '#E8622C';
  f.title.textContent = `Editing "${sc.label}"`;
  f.save.textContent = 'Save changes';
  f.cancel.style.display = '';
  f.status.textContent = '';
  f.label.focus();
}

async function refreshShortcuts() {
  const container = document.getElementById('shortcut-list');
  const result = await window.settingsAPI.getWebShortcuts();

  if (!result.ok) {
    container.innerHTML = `<div class="empty-note">Couldn't read shortcuts: ${result.error}</div>`;
    return;
  }
  if (!result.shortcuts.length) {
    container.innerHTML = '<div class="empty-note">No web shortcuts yet — add one below.</div>';
    return;
  }

  container.innerHTML = '';
  result.shortcuts.forEach((sc) => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <div class="list-row-main">
        <span class="list-row-name">
          <span class="shortcut-dot" style="background:${sc.color || '#E8622C'}"></span>${sc.label}
        </span>
        <span class="list-row-sub">${sc.url}</span>
      </div>
    `;
    const edit = document.createElement('button');
    edit.className = 'btn btn-small';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => editShortcut(sc));

    const del = document.createElement('button');
    del.className = 'btn btn-small btn-secondary';
    del.textContent = 'Remove';
    // Two-step, because a single stray press on a remote shouldn't delete
    // something silently.
    let armed = false;
    del.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        del.textContent = 'Sure?';
        setTimeout(() => { armed = false; del.textContent = 'Remove'; }, 3000);
        return;
      }
      const res = await window.settingsAPI.deleteWebShortcut(sc.id);
      if (!res.ok) shortcutForm().status.textContent = res.error;
      if (editingShortcutId === sc.id) resetShortcutForm();
      refreshShortcuts();
    });

    row.appendChild(edit);
    row.appendChild(del);
    container.appendChild(row);
  });
}

document.getElementById('shortcut-save-btn').addEventListener('click', async () => {
  const f = shortcutForm();
  f.status.textContent = 'Saving…';
  const result = await window.settingsAPI.saveWebShortcut({
    id: editingShortcutId,
    label: f.label.value,
    url: f.url.value,
    subtitle: f.subtitle.value,
    color: f.color.value,
  });
  if (!result.ok) {
    f.status.textContent = result.error;
    return;
  }
  resetShortcutForm();
  refreshShortcuts();
});

document.getElementById('shortcut-cancel-btn').addEventListener('click', resetShortcutForm);

// ---------- Boot ----------
(async function init() {
  const settings = await window.settingsAPI.getAppSettings();
  document.documentElement.setAttribute('data-theme', settings.theme);
  loadInfo();
})();
