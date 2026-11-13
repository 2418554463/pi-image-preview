import type { AttachmentStore, ImageAttachment } from "./images.ts";

/** Resolve in reference order; cursor position deliberately has no influence. */
export function draftAttachments(store: AttachmentStore, text: string): ImageAttachment[] {
  const found = new Map(store.matchingPlaceholders(text).map(a => [a.placeholder, a]));
  return [...found.values()].sort((a, b) => text.indexOf(a.placeholder) - text.indexOf(b.placeholder));
}
