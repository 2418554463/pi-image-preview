# pi-image-preview

Independent Pi extension for Codex-style image thumbnails **inside the input box**. Paste an image and see it immediately; moving the cursor does not hide it.

## Install

Requires a recent Pi with native clipboard-to-file-path handling (implemented against the installed Pi's native clipboard code; OS clipboard requires manual verification). Do not enable another image editor extension alongside this one.

```sh
pi install git:github.com/2418554463/pi-image-preview
```

Run `/reload`, then paste using Pi's image-paste shortcut, or drag/paste a local image path. Pi handles OS clipboard access; this extension handles file ingestion, image references, rendering and message attachments. No dependency on the old image-paste extension remains.

## Behavior

- Compact horizontal tiles inside the editor's borders, above the input text.
- Each tile occupies 6 columns × 3 rows with a one-pixel raster border; one-column gaps and one spacer/overflow line.
- Full images are scaled proportionally and centered, never cropped to fill the tile.
- Visible attachments follow the reference order; extra attachments show a count and are still sent.
- Quoted paths, shell-escaped spaces, relative paths and `~/` paths are supported.
- PNG/JPEG/GIF/WebP are detected by magic bytes, not extensions.
- Backspace/Delete removes image references atomically. Host editor undo/history restores references within a session.
- Inputs over 2 MiB or 2048 pixels on either axis are converted to resized JPEG at quality 85. Inputs over 32 MiB or 8 megapixels decoded are not attached. Compression is not a strict 2 MiB output guarantee.
- Previews use Pi's terminal image renderer; unsupported terminals show its text fallback. Model image support is needed to understand submitted attachments.

## Architecture

The implementation is self-contained TypeScript plus `@napi-rs/image` for pixel processing. Pi provides the editor base, terminal renderer and native clipboard integration. No old extension code is vendored.

Thumbnail geometry was informed by [Codex composer.rs](https://github.com/openai/codex/blob/main/codex-rs/tui/src/transcript_image/composer.rs). Visible tiles are combined into one PNG to avoid competing terminal graphics placements. Current tile background is neutral dark gray.

## Development

```sh
npm install
npm run check
npm test
pi -e ./src/index.ts
```

Tests cover file ingestion, magic-byte detection, quoted/escaped paths, first-attachment preview updates, chunked paste, reference deletion/restoration, payload preservation, pixel borders, complete-image scaling and multi-tile composition. Clipboard OS integration and terminal graphics still require manual verification after `/reload`.
