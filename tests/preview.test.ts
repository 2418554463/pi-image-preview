import { describe, it, expect, vi, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transformer } from "@napi-rs/image";
vi.mock("../src/thumbnail-strip.ts", () => ({ ThumbnailStrip: class {
  render() { return ["thumb1", "thumb2", "thumb3", ""]; } invalidate() {}
} }));
vi.mock("@earendil-works/pi-coding-agent", () => ({ CustomEditor: class {
  text = "";
  state = { cursorCol: 0 };
  getText() { return this.text; }
  getLines() { return [this.text]; }
  getCursor() { return { line: 0, col: this.state.cursorCol }; }
  setText(text: string) { this.text = text; this.state.cursorCol = text.length; }
  insertTextAtCursor(text: string) { this.setText(this.text + text); }
  render() { return ["top-border", this.text, "bottom-border"]; }
  invalidate() {}
  handleInput(data: string) {
    if (data === "backspace") {
      this.text = this.text.slice(0, this.state.cursorCol - 1) + this.text.slice(this.state.cursorCol);
      this.state.cursorCol--;
    }
  }
} }));
import extension from "../src/index.ts";
const dir = mkdtempSync(join(tmpdir(), "preview-test-"));
const path = join(dir, "screen shot.png");
writeFileSync(path, Transformer.fromRgbaPixels(Buffer.from([255,0,0,255]),1,1).pngSync());
afterAll(() => rmSync(dir, { recursive: true, force: true }));
function setup(mode = "tui") {
  const handlers = new Map<string, Function>();
  let editor: any;
  const tui = { requestRender: vi.fn() };
  const ui = {
    theme: { fg: (_color: string, text: string) => text }, setWidget: vi.fn(),
    setEditorComponent: vi.fn(factory => { if (factory) editor = factory(tui, {}, {
      matches: (data: string, key: string) => data === "backspace" && key.endsWith("deleteCharBackward"),
    }); }),
  };
  extension({ on: (event: string, fn: Function) => handlers.set(event, fn) } as any);
  handlers.get("session_start")!({}, { mode, hasUI: true, cwd: dir, ui });
  return { handlers, ui, tui, get editor() { return editor; } };
}
describe("independent editor", () => {
  it("handles the first file insertion from Pi's native clipboard handler", () => {
    const s = setup(); s.editor.insertTextAtCursor(path);
    expect(s.editor.getText()).toBe("[#image 1]");
    expect(s.editor.render(20)).toEqual(["top-border", "thumb1", "thumb2", "thumb3", "", "[#image 1]", "bottom-border"]);
    expect(s.tui.requestRender).toHaveBeenCalledWith(true);
    expect(s.ui.setWidget).not.toHaveBeenCalled();
  });
  it("handles chunked bracketed paste", () => {
    const s = setup(); s.editor.handleInput('\x1b[200~"' + path.slice(0, 10));
    s.editor.handleInput(path.slice(10) + '"\x1b[201~');
    expect(s.editor.getText()).toBe("[#image 1]");
  });
  it("deletes references atomically and restores previews with draft history", () => {
    const s = setup(); s.editor.insertTextAtCursor(path); s.editor.handleInput("backspace");
    expect(s.editor.render(20)).toEqual(["top-border", "", "bottom-border"]);
    s.editor.setText("[#image 1]"); expect(s.editor.render(20)[1]).toBe("thumb1");
  });
  it("submits images in reference order and preserves existing images", () => {
    const s = setup(); s.editor.insertTextAtCursor(path); s.editor.insertTextAtCursor(path);
    const result = s.handlers.get("input")!({ text: s.editor.getText(), images: [{ data: "existing" }] });
    expect(result.images).toHaveLength(3);
    expect(result.images[1].mimeType).toBe("image/png");
  });
  it("cleans up and does not install an editor in RPC", () => {
    const s = setup(); s.handlers.get("session_shutdown")!();
    expect(s.ui.setEditorComponent).toHaveBeenLastCalledWith(undefined);
    expect(setup("rpc").ui.setEditorComponent).not.toHaveBeenCalled();
  });
});
