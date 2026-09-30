# Tile images

Drop `.png` (or `.jpg` / `.svg` / `.webp`) files here to use as custom tile
icons, then reference them from `config.json`:

```json
{
  "id": "stremio",
  "label": "Stremio",
  "subtitle": "Streaming",
  "command": "stremio",
  "image": "assets/tiles/stremio.png",
  "color": "#8A5AAB"
}
```

Paths are relative to the app folder, which keeps machine-specific paths
like `/home/<you>/...` out of `config.json` and means the image travels with
the project. An absolute path works too if the file lives elsewhere.

`image` replaces the built-in `icon` for that tile. If the file is missing
the tile falls back to a plain label and the reason is written to
`error.log`, rather than showing a broken image.

Square images around 128×128 or larger work best — they're drawn scaled to
fit, so nothing is cropped.
