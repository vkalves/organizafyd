import { act, cleanup, render } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RichTextEditor } from "./RichTextEditor";

beforeEach(() => { vi.stubGlobal("ClipboardEvent", class extends Event {}); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup(content = "") {
  const onChange = vi.fn();
  const result = render(<RichTextEditor content={content} onChange={onChange} />);
  const dom = result.container.querySelector(".tiptap") as HTMLElement & { editor: Editor };
  return { ...result, dom, editor: dom.editor, onChange };
}

describe("note link mentions", () => {
  it("recognizes a typed URL after a space and preserves the following text", () => {
    const { dom, editor, onChange } = setup();
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("Veja https://example.com/path "));
      editor.view.dispatch(editor.state.tr.insertText("depois"));
    });
    const link = dom.querySelector("a.note-link-mention");
    expect(link).toHaveAttribute("href", "https://example.com/path");
    expect(link).toHaveTextContent("https://example.com/path");
    expect(link).not.toHaveTextContent("depois");
    expect(onChange).toHaveBeenCalled();
  });

  it("recognizes pasted URLs immediately and survives saving and reopening", () => {
    const { dom, editor } = setup();
    act(() => { editor.view.pasteText("https://example.com/path?q=1&next=2"); });
    expect(dom.querySelector("a.note-link-mention")).toHaveAttribute("href", "https://example.com/path?q=1&next=2");
    const saved = editor.getHTML();
    act(() => { editor.commands.setContent(saved); });
    expect(dom.querySelector("a.note-link-mention")).toHaveTextContent("https://example.com/path?q=1&next=2");
    expect(editor.getText()).toBe("https://example.com/path?q=1&next=2");
  });

  it("styles existing named links and opens them in another tab", () => {
    const { dom, editor } = setup('<p><a href="https://example.com">Meu site</a></p>');
    const link = dom.querySelector("a.note-link-mention")!;
    expect(link).toHaveTextContent("Meu site");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const event = new MouseEvent("click", { button: 0 });
    Object.defineProperty(event, "target", { value: link });
    editor.view.someProp("handleClick", handler => handler(editor.view, 2, event));
    expect(open).toHaveBeenCalledWith("https://example.com/", "_blank");
    open.mockRestore();
  });

  it("recognizes www addresses but leaves code and unsafe URLs alone", () => {
    const { dom, editor } = setup();
    act(() => { editor.view.pasteText("www.example.com"); });
    expect(dom.querySelector("a")).toHaveAttribute("href", "http://www.example.com");
    act(() => { editor.commands.setContent('<pre><code>https://example.com </code></pre>'); });
    expect(dom.querySelector("a")).toBeNull();
    act(() => { editor.commands.setContent('<p><a href="javascript:alert(1)">unsafe</a></p>'); });
    expect(dom.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});
