import { Image, getCellDimensions, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { ImageAttachment } from "./images.ts";
import { Transformer, ResizeFit } from "@napi-rs/image";

// Match Codex's composer: six columns × three rows, one column gap.
const WIDTH = 6;
const HEIGHT = 3;
const GAP = 1;
const BACKGROUND = [48, 48, 48] as const;

/** Border is part of the raster, not terminal text that can intersect graphics. */
export function thumbnailRaster(attachment: ImageAttachment, width: number, height: number): Buffer {
  const source = new Transformer(Buffer.from(attachment.data, "base64"));
  const meta = source.metadataSync();
  if (meta.width * meta.height > 32 * 1024 * 1024 / 4) throw new Error("Image too large for optional preview");
  const resized = source.rotate().resize({
    width: Math.min(meta.width, width - 2),
    height: Math.min(meta.height, height - 2),
    fit: ResizeFit.Inside,
  }).pngSync();
  const size = new Transformer(resized).metadataSync();
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = edge ? 141 : BACKGROUND[0];
    pixels[offset + 3] = 255;
  }
  return Transformer.fromRgbaPixels(pixels, width, height)
    .overlay(resized, Math.floor((width - size.width) / 2), Math.floor((height - size.height) / 2)).pngSync();
}

/** One composite image avoids competing native image cursor placements in a text row. */
export class ThumbnailStrip implements Component {
  private cacheKey = "";
  private image?: Image;
  private tiles = new Map<string, Buffer>();
  constructor(private attachments: ImageAttachment[], private muted: (text: string) => string) {}

  render(width: number): string[] {
    const { count, overflow } = stripLayout(width, this.attachments.length);
    if (!count) return [truncateToWidth(this.muted(`+${this.attachments.length} images`), width)];
    const cell = getCellDimensions();
    const cw = Math.max(1, Math.round(cell.widthPx));
    const ch = Math.max(1, Math.round(cell.heightPx));
    const columns = count * (WIDTH + GAP) - GAP;
    const key = `${count}:${cw}:${ch}`;
    if (key !== this.cacheKey) {
      const w = columns * cw, h = HEIGHT * ch;
      const canvas = Buffer.alloc(w * h * 4);
      for (let i = 0; i < canvas.length; i += 4) {
        canvas[i] = canvas[i + 1] = canvas[i + 2] = BACKGROUND[0]; canvas[i + 3] = 255;
      }
      let composite = Transformer.fromRgbaPixels(canvas, w, h);
      this.attachments.slice(0, count).forEach((attachment, index) => {
        const tileKey = `${index}:${cw}:${ch}`;
        try {
          let tile = this.tiles.get(tileKey);
          if (!tile) { tile = thumbnailRaster(attachment, WIDTH * cw, HEIGHT * ch); this.tiles.set(tileKey, tile); }
          composite = composite.overlay(tile, index * (WIDTH + GAP) * cw, 0);
        } catch { /* Optional preview failure must not block image submission. */ }
      });
      this.image = new Image(composite.pngSync().toString("base64"), "image/png",
        { fallbackColor: this.muted }, { maxWidthCells: columns, maxHeightCells: HEIGHT },
        { widthPx: w, heightPx: h });
      this.cacheKey = key;
    }
    // Image's API reserves two columns internally; supply them explicitly.
    const lines = this.image!.render(columns + 2);
    // Keep overflow text off graphics rows to avoid native cursor-position conflicts.
    return [...lines, overflow ? this.muted(`+${overflow}`) : ""];
  }
  invalidate() { this.image?.invalidate(); }
}

export function stripLayout(width: number, total: number) {
  const count = Math.min(total, Math.max(0, Math.floor((width + GAP) / (WIDTH + GAP))));
  return { count, overflow: total - count };
}
