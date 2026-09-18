import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import LinkExt from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { useEffect, useCallback } from "react";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, List, ListOrdered,
  CheckSquare, Link2, Heading1, Heading2, Undo, Redo, Code
} from "lucide-react";
import { cn } from "@/lib/utils";

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}

interface EditorToolButtonProps {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
}

function EditorToolButton({ active, onClick, children, title }: EditorToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        "flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        active && "bg-accent text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({ content, onChange, placeholder = "Escreva sua nota...", className }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      LinkExt.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: content || "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: "prose prose-invert prose-sm min-h-full max-w-none [overflow-wrap:anywhere] px-4 py-4 text-foreground focus:outline-none sm:px-5",
      },
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || "", { emitUpdate: false });
    }
  }, [content, editor]);

  const addLink = useCallback(() => {
    if (!editor) return;
    const url = window.prompt("URL do link:");
    if (url) {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  }, [editor]);

  if (!editor) return null;

  return (
    <div className={cn("flex min-h-[20rem] min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-secondary", className)}>
      <div className="scrollbar-none flex shrink-0 flex-nowrap items-center gap-0.5 overflow-x-auto overscroll-x-contain border-b border-border bg-secondary/70 p-1.5" role="toolbar" aria-label="Ferramentas de formatação">
        <EditorToolButton active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Título 1">
          <Heading1 className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Título 2">
          <Heading2 className="h-4 w-4" />
        </EditorToolButton>
        <div className="mx-1 h-5 w-px shrink-0 bg-border" />
        <EditorToolButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Negrito">
          <Bold className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Itálico">
          <Italic className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Sublinhado">
          <UnderlineIcon className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Riscado">
          <Strikethrough className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} title="Código">
          <Code className="h-4 w-4" />
        </EditorToolButton>
        <div className="mx-1 h-5 w-px shrink-0 bg-border" />
        <EditorToolButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Lista">
          <List className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Lista numerada">
          <ListOrdered className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()} title="Checklist">
          <CheckSquare className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton active={editor.isActive("link")} onClick={addLink} title="Link">
          <Link2 className="h-4 w-4" />
        </EditorToolButton>
        <div className="mx-1 h-5 w-px shrink-0 bg-border" />
        <EditorToolButton onClick={() => editor.chain().focus().undo().run()} title="Desfazer">
          <Undo className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton onClick={() => editor.chain().focus().redo().run()} title="Refazer">
          <Redo className="h-4 w-4" />
        </EditorToolButton>
      </div>
      <EditorContent editor={editor} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" />
    </div>
  );
}
