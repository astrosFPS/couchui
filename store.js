const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function storePath() {
  return path.join(app.getPath('userData'), 'app-settings.json');
}

const DEFAULTS = {
  theme: 'dark',       // 'dark' | 'light'
  background: {
    mode: 'theme',       // 'theme' | 'color' | 'image' | 'slideshow'
    color: '#1DB954',     // used when mode === 'color'
    image: null,           // absolute file path, used when mode === 'image'
    slideshow: {
      images: [],           // array of absolute file paths, used when mode === 'slideshow'
      intervalSeconds: 15,   // how long each image shows before switching
      fadeSeconds: 2,         // crossfade duration between images
    },
  },
  font: {
    family: 'system',    // 'system' | 'roboto' | 'open-sans' | 'merriweather' | 'jetbrains-mono' | 'custom'
    customName: null,      // font-family name registered for the uploaded font, when family === 'custom'
    customPath: null,       // absolute path to the uploaded font file (copied into userData)
    scale: 100,               // percent, 100 = current default size
    color: null,               // hex string, null = keep the theme's own text color
    opacity: 100,                // percent
  },
  updates: {
    autoCheck: false,    // whether to check for updates on a schedule, unattended
    lastChecked: null,    // ISO timestamp of the last check (manual or automatic), or null
  },
  spotify: {
    pinnedPlaylistIds: [],  // playlist ids pinned to the front of "Your Playlists"
    shuffle: true,           // applied when starting a playlist/album
  },
  location: {
    timeZone: 'system',   // 'system' (follow the OS) or an IANA name e.g. 'Pacific/Auckland'
    clockFormat: 'auto',   // 'auto' (follow locale) | '12' | '24'
    showSeconds: false,
  },
  weather: {
    style: 'detailed',   // 'detailed' | 'compact' | 'minimal'
    units: 'celsius',     // 'celsius' | 'fahrenheit'
    showIcon: true,
    showCondition: true,
    showLocation: true,
    showFeelsLike: false,
    showHumidity: false,
    showWind: false,
  },
};

function load() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(storePath(), 'utf-8'));
  } catch (err) {
    saved = {};
  }

  // One-time migration: earlier versions stored a single flat `wallpaper`
  // path instead of the `background` shape below.
  if (saved.wallpaper && !saved.background) {
    saved.background = { mode: 'image', image: saved.wallpaper };
  }
  delete saved.wallpaper;

  return {
    ...DEFAULTS,
    ...saved,
    background: {
      ...DEFAULTS.background,
      ...saved.background,
      slideshow: { ...DEFAULTS.background.slideshow, ...saved.background?.slideshow },
    },
    font: { ...DEFAULTS.font, ...saved.font },
    updates: { ...DEFAULTS.updates, ...saved.updates },
    spotify: { ...DEFAULTS.spotify, ...saved.spotify },
    location: { ...DEFAULTS.location, ...saved.location },
    weather: { ...DEFAULTS.weather, ...saved.weather },
  };
}

function save(data) {
  fs.writeFileSync(storePath(), JSON.stringify(data, null, 2));
}

module.exports = { load, save };
