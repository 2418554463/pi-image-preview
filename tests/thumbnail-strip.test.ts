import { describe, expect, it, vi } from "vitest";
import { Transformer } from "@napi-rs/image";
const captured = vi.hoisted(() => ({ png: "" }));
vi.mock("@earendil-works/pi-tui", async importOriginal => {
  const original = await importOriginal<typeof import("@earendil-works/pi-tui")>();
  return { ...original, Image: class {
    constructor(data: string) { captured.png = data; }
    render() { return ["", "", ""]; }
    invalidate() {}
  } };
});
import { ThumbnailStrip, stripLayout, thumbnailRaster } from "../src/thumbnail-strip.ts";
import { visibleWidth } from "@earendil-works/pi-tui";
const red = Transformer.fromRgbaPixels(Buffer.from([255, 0, 0, 255]), 1, 1).pngSync().toString("base64");
const attachments = Array.from({ length: 20 }, (_, i) => ({
  placeholder: `[#image ${i + 1}]`, data: red, mimeType: "image/png",
})) as any;

describe("Codex-style raster filmstrip", () => {
  it("uses three image rows plus a spacer, with no character borders or labels", () => {
    const rows = new ThumbnailStrip(attachments, s => s).render(100);
    expect(rows).toHaveLength(4);
    expect(rows.join("\n")).not.toMatch(/[┌┐│]|\[#image/);
    expect(rows[3]).toContain("+");
  });
  it("fits narrow terminal widths", () => {
    for (let width = 1; width < 30; width++) {
      const rows = new ThumbnailStrip(attachments, s => s).render(width);
      expect(rows.every(row => visibleWidth(row) <= width)).toBe(true);
    }
  });
  it("matches six-column tiles and one-column gaps", () => {
    expect(stripLayout(20, 3)).toEqual({ count: 3, overflow: 0 });
    expect(stripLayout(19, 3)).toEqual({ count: 2, overflow: 1 });
  });
  it("retains every tile when composing multiple images", () => {
    new ThumbnailStrip(attachments.slice(0, 3), s => s).render(20);
    const image = new Transformer(Buffer.from(captured.png, "base64"));
    const { width, height } = image.metadataSync();
    const cw = width / 20;
    const pixels = image.rawPixelsSync();
    for (const column of [0, 7, 14]) {
      const offset = column * cw * 4;
      expect([...pixels.subarray(offset, offset + 4)]).toEqual([141, 141, 141, 255]);
    }
    expect(height).toBeGreaterThan(0);
  });
  it.each([[400, 40], [40, 400]])("contains the entire %i × %i image without cover-cropping", (w, h) => {
    const source = Buffer.alloc(w * h * 4);
    for (let i = 0; i < source.length; i += 4) { source[i] = 255; source[i + 3] = 255; }
    const data = Transformer.fromRgbaPixels(source, w, h).pngSync().toString("base64");
    const tile = new Transformer(thumbnailRaster({ ...attachments[0], data }, 48, 48));
    const pixels = tile.rawPixelsSync();
    let left = 48, right = -1, top = 48, bottom = -1;
    for (let y = 1; y < 47; y++) for (let x = 1; x < 47; x++) {
      const i = (y * 48 + x) * 4;
      if (pixels[i] > 200 && pixels[i + 1] < 30) {
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    expect(right).toBeGreaterThan(left);
    expect(bottom).toBeGreaterThan(top);
    const ratio = (right - left + 1) / (bottom - top + 1);
    if (w > h) expect(ratio).toBeGreaterThan(8);
    else expect(ratio).toBeLessThan(0.125);
    expect(Math.abs(left - (47 - right))).toBeLessThanOrEqual(1);
    expect(Math.abs(top - (47 - bottom))).toBeLessThanOrEqual(1);
  });
  it("composites a pixel border and centers the source without upscaling", () => {
    const png = thumbnailRaster(attachments[0], 48, 48);
    const transformer = new Transformer(png);
    expect(transformer.metadataSync()).toMatchObject({ width: 48, height: 48 });
    const pixels = transformer.rawPixelsSync();
    expect([...pixels.subarray(0, 4)]).toEqual([141, 141, 141, 255]);
    const center = (23 * 48 + 23) * 4;
    expect([...pixels.subarray(center, center + 4)]).toEqual([255, 0, 0, 255]);
    expect([...pixels.subarray(49 * 4, 50 * 4)]).toEqual([48, 48, 48, 255]);
  });
});
