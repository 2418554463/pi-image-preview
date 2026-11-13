import { it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Transformer } from "@napi-rs/image";
import { AttachmentStore, attachPaths, detectMime, imagesForText } from "../src/images.ts";
const dir = mkdtempSync(join(tmpdir(), "image-ingest-"));
const png = Transformer.fromRgbaPixels(Buffer.from([0,255,0,255]),1,1).pngSync();
writeFileSync(join(dir, "a b.bin"), png);
writeFileSync(join(dir, "text.png"), "not an image");
afterAll(() => rmSync(dir, { recursive: true, force: true }));
it("detects magic bytes, not file extensions", () => {
  expect(detectMime(png)).toBe("image/png");
  expect(detectMime(Buffer.from("not image"))).toBeUndefined();
  expect(new AttachmentStore().load("text.png", dir)).toBeUndefined();
});
it("supports quotes, escaped spaces, multiple paths, and ordinary text", () => {
  const store = new AttachmentStore();
  expect(attachPaths('"a b.bin"', store, dir)).toBe("[#image 1]");
  expect(attachPaths("a\\ b.bin", store, dir)).toBe("[#image 2]");
  expect(attachPaths('compare "a b.bin" and "a b.bin"', store, dir)).toBe("compare [#image 3] and [#image 4]");
  expect(attachPaths("normal prose", store, dir)).toBe("normal prose");
  expect(imagesForText(store, "[#image 2] [#image 1]")).toHaveLength(2);
});
it("preserves all original pixels for small inputs", () => {
  const image = new AttachmentStore().load("a b.bin", dir)!;
  expect(Buffer.from(image.data, "base64")).toEqual(png);
  expect(image.dimensions).toEqual({ widthPx: 1, heightPx: 1 });
});
