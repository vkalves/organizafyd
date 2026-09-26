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

  it("allows ordinary clicks to edit and modifier clicks to open links", () => {
    const { dom, editor } = setup('<p><a href="https://example.com">Meu site</a></p>');
    const link = dom.querySelector("a.note-link-mention")!;
    expect(link).toHaveTextContent("Meu site");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const event = new MouseEvent("click", { button: 0 });
    Object.defineProperty(event, "target", { value: link });
    editor.view.someProp("handleClick", handler => handler(editor.view, 2, event));
    expect(open).not.toHaveBeenCalled();
    const modifierClick = new MouseEvent("click", { button: 0, ctrlKey: true });
    Object.defineProperty(modifierClick, "target", { value: link.querySelector("span") });
    editor.view.someProp("handleClick", handler => handler(editor.view, 2, modifierClick));
    expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("keeps text after a pasted link outside the link and supports editing and undo", () => {
    const { editor, dom } = setup();
    act(() => { editor.view.pasteText("https://example.com"); });
    act(() => { editor.view.dispatch(editor.state.tr.insertText(" texto depois")); });
    expect(dom.querySelector("a")).toHaveTextContent(/^https:\/\/example\.com$/);
    expect(editor.getText()).toBe("https://example.com texto depois");
    act(() => {
      editor.commands.setTextSelection(1);
      editor.view.dispatch(editor.state.tr.insertText("Antes "));
    });
    expect(editor.getText()).toBe("Antes https://example.com texto depois");
    expect(dom.querySelector("a")).not.toHaveTextContent("Antes");
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.commands.splitBlock();
      editor.view.dispatch(editor.state.tr.insertText("Nova linha"));
    });
    expect(dom.querySelectorAll("p")).toHaveLength(2);
    expect(dom.querySelectorAll("p")[1]).toHaveTextContent("Nova linha");
    act(() => { editor.commands.undo(); });
    expect(editor.getText()).not.toContain("Nova linha");
  });

  it("switches between read-only and editing without changing the note", () => {
    const content = '<p>Nota <a href="https://example.com">site</a></p>';
    const onChange = vi.fn();
    const result = render(<RichTextEditor content={content} onChange={onChange} readOnly />);
    const dom = result.container.querySelector(".tiptap") as HTMLElement & { editor: Editor };
    expect(dom).toHaveAttribute("contenteditable", "false");
    expect(result.queryByRole("toolbar")).toBeNull();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const event = new MouseEvent("click", { button: 0 });
    Object.defineProperty(event, "target", { value: dom.querySelector("a span") });
    dom.editor.view.someProp("handleClick", handler => handler(dom.editor.view, 7, event));
    expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
    result.rerender(<RichTextEditor content={content} onChange={onChange} readOnly={false} />);
    expect(dom).toHaveAttribute("contenteditable", "true");
    expect(result.getByRole("toolbar")).toBeInTheDocument();
    result.rerender(<RichTextEditor content={content} onChange={onChange} readOnly />);
    expect(dom).toHaveAttribute("contenteditable", "false");
    expect(dom).toHaveTextContent("Nota site");
    expect(onChange).not.toHaveBeenCalled();
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
