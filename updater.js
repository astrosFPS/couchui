// ===================== Update checker (stub) =====================
// This is the one place the real update logic needs to go. Nothing here
// actually checks anything yet — checkForUpdate() always reports "no
// update available" — but the rest of the app (Settings → Updates tab,
// the "Search for update" button, the automatic-checks toggle and its
// scheduler in main.js) is fully wired up to call this function and
// display whatever it returns. Fill in the body below and everything
// downstream of it starts working with no other changes needed.
//
// A typical implementation polls a GitHub releases endpoint, e.g.:
//
//   const res = await fetch('https://api.github.com/repos/<owner>/<repo>/releases/latest');
//   const release = await res.json();
//   const latestVersion = release.tag_name.replace(/^v/, '');
//
// ...then compares latestVersion against currentVersion (semver compare,
// not just !==, so "1.10.0" doesn't look older than "1.9.0") to decide
// updateAvailable, and sets downloadUrl to whichever release asset matches
// this platform (release.assets[].browser_download_url).

const { app } = require('electron');

async function checkForUpdate() {
  const currentVersion = app.getVersion();

  // TODO: replace this with a real check (see comment above). Until then,
  // this always reports "nothing to do" — configured: false is what the
  // Settings UI uses to show "not set up yet" instead of a real result.
  return {
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    downloadUrl: null,
    checkedAt: new Date().toISOString(),
    configured: false,
  };
}

module.exports = { checkForUpdate };
