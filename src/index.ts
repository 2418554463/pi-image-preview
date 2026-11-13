import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ThumbnailStrip } from "./thumbnail-strip.ts";
import { AttachmentStore, imagesForText, attachPaths } from "./images.ts";
import { draftAttachments } from "./draft.ts";

export default function imagePreview(pi: ExtensionAPI) {
  const store = new AttachmentStore();
  let dispose: (() => void) | undefined;
  pi.on("session_start", (_event, ctx) => {
    dispose?.(); store.clear();
    if (!ctx.hasUI || ("mode" in ctx && ctx.mode !== "tui")) return;
    let preview: ThumbnailStrip | undefined;
    let signature = "";
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const refresh = (text: string) => {
        const attachments = draftAttachments(store, text);
        const next = attachments.map(a => a.placeholder).join("|");
        if (next === signature) return;
        signature = next;
        preview = attachments.length ? new ThumbnailStrip(attachments, text => ctx.ui.theme.fg("dim", text)) : undefined;
        tui.requestRender(true);
      };
      class DraftEditor extends CustomEditor {
        private imagePasteBuffer: string | undefined;
        override render(width: number): string[] {
          const lines = super.render(width);
          return preview ? [lines[0] ?? "", ...preview.render(width), ...lines.slice(1)] : lines;
        }
        override invalidate() { super.invalidate(); preview?.invalidate(); }
        override setText(text: string) { super.setText(text); refresh(this.getText()); }
        override insertTextAtCursor(text: string) {
          super.insertTextAtCursor(attachPaths(text, store, ctx.cwd));
          refresh(this.getText());
          tui.requestRender();
        }
        override handleInput(data: string) {
          // Buffer terminal bracketed-paste chunks before parsing file paths.
          const start = "\x1b[200~", end = "\x1b[201~";
          if (this.imagePasteBuffer !== undefined || data.includes(start)) {
            if (this.imagePasteBuffer === undefined) {
              const index = data.indexOf(start);
              if (index > 0) super.handleInput(data.slice(0, index));
              this.imagePasteBuffer = data.slice(index + start.length);
            } else this.imagePasteBuffer += data;
            const stop = this.imagePasteBuffer.indexOf(end);
            if (stop < 0) return;
            const text = this.imagePasteBuffer.slice(0, stop);
            const remaining = this.imagePasteBuffer.slice(stop + end.length);
            this.imagePasteBuffer = undefined;
            this.insertTextAtCursor(text);
            if (remaining) this.handleInput(remaining);
            return;
          }
          // Delete image references atomically while retaining ordinary editor undo.
          const backward = keybindings.matches(data, "tui.editor.deleteCharBackward");
          const forward = keybindings.matches(data, "tui.editor.deleteCharForward");
          if (backward || forward) {
            const cursor = this.getCursor();
            const line = this.getLines()[cursor.line] ?? "";
            const match = [...line.matchAll(/\[#image \d+\]/g)].find(m =>
              store.matchingPlaceholders(m[0]).length && (backward
                ? cursor.col > m.index && cursor.col <= m.index + m[0].length
                : cursor.col >= m.index && cursor.col < m.index + m[0].length));
            if (match) {
              // Place cursor at the token boundary, then let the host perform each
              // deletion so its undo bookkeeping stays intact.
              const state = this as unknown as { state: { cursorCol: number } };
              state.state.cursorCol = backward ? match.index + match[0].length : match.index;
              for (let i = 0; i < match[0].length; i++) super.handleInput(data);
              refresh(this.getText());
              return;
            }
          }
          super.handleInput(data);
          refresh(this.getText());
        }
      }
      // Leave onPasteImage unset: Pi supplies its native clipboard handler. It
      // writes clipboard images to a temp file and calls insertTextAtCursor above.
      return new DraftEditor(tui, theme, keybindings);
    });
    dispose = () => { preview = undefined; ctx.ui.setEditorComponent(undefined); };
  });
  pi.on("input", (event) => {
    if (event.source === "extension" || !store.matchingPlaceholders(event.text).length) return;
    return { action: "transform" as const, text: event.text, images: imagesForText(store, event.text, event.images) };
  });
  pi.on("session_shutdown", () => { dispose?.(); dispose = undefined; store.clear(); });
}
