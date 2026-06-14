# OpenXD

OpenXD is a private, browser-only viewer for Adobe XD files. Files are parsed
locally and are never uploaded.

## Development

```sh
npm install
npm run dev
```

OpenXD provides best-effort rendering because Adobe XD's package format is
proprietary. Common artboards, shapes, paths, text, images, fills, strokes, and
transforms are supported; unknown content is reported as a compatibility
warning.


