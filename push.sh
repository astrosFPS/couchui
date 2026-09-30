#!/usr/bin/env bash
# Commit and push CouchUI to your git remote.
#
#   ./push.sh                     # commits everything with a version-stamped message
#   ./push.sh "fixed skip bug"    # commits everything with your own message
#
# config.json is excluded by .gitignore, so your Spotify client ID and
# weather location never leave this machine. This script checks that before
# it pushes anything.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

if [[ ! -d .git ]]; then
  echo "No git repository here yet. Set one up first:"
  echo
  echo "  cd $APP_DIR"
  echo "  git init -b main"
  echo "  git remote add origin git@github.com:YOUR_USER/couch-ui.git"
  echo
  echo "Then run this script again."
  exit 1
fi

# --- safety: never push the private config ---
# .gitignore only applies to untracked files. If config.json was committed
# before the ignore rule existed, git keeps tracking it and the credentials
# would go out with every push.
if git ls-files --error-unmatch config.json >/dev/null 2>&1; then
  echo "STOP: config.json is tracked by git — it holds your Spotify client ID."
  echo
  echo "Untrack it (keeping your local copy) with:"
  echo "  git rm --cached config.json"
  echo "  git commit -m 'stop tracking config.json'"
  echo
  echo "If it has already been pushed, treat that client ID as exposed and"
  echo "rotate it in the Spotify Developer Dashboard."
  exit 1
fi

if [[ -z "$(git status --porcelain)" ]]; then
  echo "Nothing to commit — working tree is clean."
  exit 0
fi

# Default the message to the current version, so history lines up with
# VERSION.log without having to think about it.
VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo '')"
MESSAGE="${1:-${VERSION:+v$VERSION}}"
MESSAGE="${MESSAGE:-update}"

echo "Changes to be committed:"
git status --short
echo

git add -A
git commit -m "$MESSAGE"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# First push on a new branch needs -u to set the upstream; after that a
# plain push is enough.
if git rev-parse --abbrev-ref --symbolic-full-name "@{u}" >/dev/null 2>&1; then
  git push
else
  git push -u origin "$BRANCH"
fi

echo
echo "Pushed \"$MESSAGE\" to $BRANCH."
