import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { Transformer, ResizeFit } from "@napi-rs/image";

export interface ImageAttachment {
  placeholder: string;
  originalPath: string;
  data: string;
  mimeType: string;
  dimensions: { widthPx: number; heightPx: number };
}

export function detectMime(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString())) return "image/gif";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return undefined;
}

export class AttachmentStore {
  private items: ImageAttachment[] = [];
  clear() { this.items = []; }
  matchingPlaceholders(text: string) { return this.items.filter(a => text.includes(a.placeholder)); }
  load(path: string, cwd: string): ImageAttachment | undefined {
    path = path.replace(/^file:\/\//, "");
    if (path.startsWith("~/")) path = homedir() + path.slice(1);
    const absolute = resolve(cwd, path);
    const stat = statSync(absolute);
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024) return;
    let bytes: Buffer = readFileSync(absolute);
    let mimeType = detectMime(bytes);
    if (!mimeType) return;
    const meta = new Transformer(bytes).metadataSync();
    if (meta.width * meta.height > 32 * 1024 * 1024 / 4) throw new Error("Image decoded size exceeds preview limit");
    let dimensions = { widthPx: meta.width, heightPx: meta.height };
    // Bound provider payloads, independently of the small preview raster.
    if (bytes.length > 2 * 1024 * 1024 || Math.max(meta.width, meta.height) > 2048) {
      bytes = new Transformer(bytes).rotate().resize({ width: 2048, height: 2048, fit: ResizeFit.Inside }).jpegSync(85);
      mimeType = "image/jpeg";
      const resized = new Transformer(bytes).metadataSync();
      dimensions = { widthPx: resized.width, heightPx: resized.height };
    }
    const attachment = { placeholder: `[#image ${this.items.length + 1}]`, originalPath: absolute,
      data: bytes.toString("base64"), mimeType, dimensions };
    this.items.push(attachment);
    return attachment;
  }
}

/** Paste paths, including quoted paths and macOS shell-escaped spaces. */
export function attachPaths(text: string, store: AttachmentStore, cwd: string): string {
  const convert = (raw: string) => {
    try { return store.load(raw, cwd)?.placeholder; } catch { return undefined; }
  };
  const whole = text.trim();
  if (whole && !whole.includes("\n")) {
    const unquoted = whole.replace(/^(['"])(.*)\1$/, "$2").replace(/\\([ ()'"&\[\]])/g, "$1");
    const placeholder = convert(unquoted);
    if (placeholder) return text.replace(whole, placeholder);
  }
  return text.replace(/"([^"\n]+)"|'([^'\n]+)'|(?:\\[^\n]|[^\s"'])+/g, (token, double, single) => {
    const path = (double ?? single ?? token).replace(/\\([ ()'"&\[\]])/g, "$1");
    return convert(path) ?? token;
  });
}

export function imagesForText(store: AttachmentStore, text: string, existing: { type: "image"; data: string; mimeType: string }[] = []) {
  return [...existing, ...store.matchingPlaceholders(text)
    .sort((a, b) => text.indexOf(a.placeholder) - text.indexOf(b.placeholder))
    .map(({ data, mimeType }) => ({ type: "image" as const, data, mimeType }))];
}
