import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import LinkExt from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bold,
  CheckSquare,
  Code,
  Eraser,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo,
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
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
}

function EditorToolButton({
  active,
  disabled,
  onClick,
  children,
  title,
}: EditorToolButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        "flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35",
        active && "bg-accent text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ToolDivider() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

export function RichTextEditor({
  content,
  onChange,
  placeholder = "Escreva sua nota...",
  className,
}: RichTextEditorProps) {
  const [plainText, setPlainText] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
        underline: false,
      }),
      Underline,
      LinkExt.configure({
        openOnClick: true,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        HTMLAttributes: {
          class: "note-link-mention",
          title: "Abrir link em outra aba",
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: content || "",
    onCreate: ({ editor }) => setPlainText(editor.getText()),
    onUpdate: ({ editor }) => {
      setPlainText(editor.getText());
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-invert prose-sm min-h-full max-w-none [overflow-wrap:anywhere] px-4 py-5 text-foreground focus:outline-none sm:px-6 sm:py-6",
      },
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || "", { emitUpdate: false });
      setPlainText(editor.getText());
    }
  }, [content, editor]);

  const stats = useMemo(() => {
    const text = plainText.trim();
    return {
      words: text ? text.split(/\s+/).length : 0,
      characters: plainText.length,
    };
  }, [plainText]);

  const editLink = useCallback(() => {
    if (!editor) return;

    const currentHref = editor.getAttributes("link").href || "";
    const url = window.prompt(
      currentHref
        ? "Edite o link. Deixe vazio para remover:"
        : "Cole ou digite a URL:",
      currentHref,
    );

    if (url === null) return;

    if (!url.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    const normalized = /^https?:\/\//i.test(url.trim())
      ? url.trim()
      : `https://${url.trim()}`;

    editor.chain().focus().extendMarkRange("link").setLink({ href: normalized }).run();
  }, [editor]);

  const clearFormatting = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().unsetAllMarks().clearNodes().run();
  }, [editor]);

  if (!editor) return null;

  return (
    <div
      className={cn(
        "flex min-h-[20rem] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-secondary",
        className,
      )}
    >
      <div
        className="scrollbar-none flex shrink-0 flex-nowrap items-center gap-0.5 overflow-x-auto overscroll-x-contain border-b border-border bg-secondary/85 p-1.5"
        role="toolbar"
        aria-label="Ferramentas de formatação"
      >
        <EditorToolButton
          active={editor.isActive("paragraph")}
          onClick={() => editor.chain().focus().setParagraph().run()}
          title="Parágrafo"
        >
          <Pilcrow className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton
          active={editor.isActive("heading", { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          title="Título 1"
        >
          <Heading1 className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          title="Título 2"
        >
          <Heading2 className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          title="Título 3"
        >
          <Heading3 className="h-4 w-4" />
        </EditorToolButton>

        <ToolDivider />

        <EditorToolButton
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Negrito · Ctrl+B"
        >
          <Bold className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Itálico · Ctrl+I"
        >
          <Italic className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="Sublinhado · Ctrl+U"
        >
          <UnderlineIcon className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title="Riscado"
        >
          <Strikethrough className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton
          active={editor.isActive("code")}
          onClick={() => editor.chain().focus().toggleCode().run()}
          title="Código inline"
        >
          <Code className="h-4 w-4" />
        </EditorToolButton>

        <ToolDivider />

        <EditorToolButton
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Lista"
        >
          <List className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Lista numerada"
        >
          <ListOrdered className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton
          active={editor.isActive("taskList")}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          title="Checklist"
        >
          <CheckSquare className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title="Citação"
        >
          <Quote className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Separador"
        >
          <Minus className="h-4 w-4" />
        </EditorToolButton>

        <ToolDivider />

        <EditorToolButton
          active={editor.isActive("link")}
          onClick={editLink}
          title={editor.isActive("link") ? "Editar/remover link" : "Adicionar link"}
        >
          <Link2 className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton
          onClick={clearFormatting}
          title="Limpar formatação"
        >
          <Eraser className="h-4 w-4" />
        </EditorToolButton>

        <ToolDivider />

        <EditorToolButton
          disabled={!editor.can().chain().focus().undo().run()}
          onClick={() => editor.chain().focus().undo().run()}
          title="Desfazer · Ctrl+Z"
        >
          <Undo className="h-4 w-4" />
        </EditorToolButton>
        <EditorToolButton
          disabled={!editor.can().chain().focus().redo().run()}
          onClick={() => editor.chain().focus().redo().run()}
          title="Refazer · Ctrl+Shift+Z"
        >
          <Redo className="h-4 w-4" />
        </EditorToolButton>
      </div>

      <EditorContent
        editor={editor}
        onWheel={(event) => event.stopPropagation()}
        className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain bg-secondary"
      />

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-secondary/70 px-3 py-2 text-[10px] text-muted-foreground sm:px-4">
        <span>{stats.words} {stats.words === 1 ? "palavra" : "palavras"} · {stats.characters} caracteres</span>
        <span className="hidden sm:inline">Ctrl+S para salvar</span>
      </div>
    </div>
  );
}
