import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import type { Editor } from "@tiptap/react";
import { ingestImageFile, setImageSink, clearImageSink, type StoredImage } from "../images";
import { LocalImage, withLiveImageSrc } from "../localImage";
import { toEditorHtml } from "../richtext";
import { useI18n } from "../i18n";

interface Props {
  debtId: number;
  html: string;
  placeholder: string;
  expanded?: boolean;
  onChange: (html: string) => void;
  onExpand?: () => void;
  onCollapse?: () => void;
  onImageInserted?: () => void;
}

function insertStoredImage(editor: Editor, img: StoredImage) {
  editor
    .chain()
    .focus()
    .insertContent({
      type: "image",
      attrs: { src: img.src, path: img.path, alt: img.filename },
    })
    .run();
}

export interface RichEditorHandle {
  selectedText: () => string;
}

export const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(
  {
    debtId,
    html,
    placeholder,
    expanded = false,
    onChange,
    onExpand,
    onCollapse,
    onImageInserted,
  },
  ref
) {
  const { t } = useI18n();
  const debtIdRef = useRef(debtId);
  debtIdRef.current = debtId;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onImageInsertedRef = useRef(onImageInserted);
  onImageInsertedRef.current = onImageInserted;
  const insertRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  const owner = useRef(Symbol("editor"));
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: { enableTabIndentation: true, tabSize: 4 },
      }),
      LocalImage.configure({
        inline: false,
        allowBase64: false,
        resize: {
          enabled: true,
          minWidth: 48,
          minHeight: 48,
          alwaysPreserveAspectRatio: true,
        },
      }),
      Placeholder.configure({ placeholder }),
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: withLiveImageSrc(toEditorHtml(html)),
    editorProps: {
      attributes: { class: "rich-prose" },
      handleKeyDown: (view, event) => {
        if (event.key !== "Tab") return false;
        event.preventDefault();
        const ed = editorRef.current;
        if (event.shiftKey) {
          if (ed?.commands.liftListItem("listItem")) return true;
          const { $from, empty } = view.state.selection;
          if (empty && $from.parentOffset > 0) {
            const prev = $from.parent.textBetween($from.parentOffset - 1, $from.parentOffset);
            if (prev === "\t") view.dispatch(view.state.tr.delete($from.pos - 1, $from.pos));
          }
          return true;
        }
        if (ed?.commands.sinkListItem("listItem")) return true;
        view.dispatch(view.state.tr.insertText("\t"));
        return true;
      },
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        const images: File[] = [];
        for (const item of items) {
          if (item.type.startsWith("image/")) {
            const f = item.getAsFile();
            if (f) images.push(f);
          }
        }
        if (images.length === 0) return false;
        event.preventDefault();
        void insertRef.current(images);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
        if (images.length === 0) return false;
        event.preventDefault();
        event.stopPropagation();
        void insertRef.current(images);
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => onChangeRef.current(ed.getHTML()),
  });
  editorRef.current = editor;

  useImperativeHandle(
    ref,
    () => ({
      selectedText: () => {
        if (!editor) return "";
        const { from, to } = editor.state.selection;
        if (from === to) return "";
        return editor.state.doc.textBetween(from, to, "\n").trim();
      },
    }),
    [editor]
  );

  insertRef.current = async (files: File[]) => {
    if (!editor) return;
    for (const file of files) {
      try {
        const stored = await ingestImageFile(debtIdRef.current, file);
        insertStoredImage(editor, stored);
        onImageInsertedRef.current?.();
      } catch (e) {
        console.error(e);
      }
    }
  };

  useEffect(() => {
    if (!editor) return;
    const grabSink = () => {
      setImageSink((img) => {
        insertStoredImage(editor, img);
        onImageInsertedRef.current?.();
      }, owner.current);
    };
    const onBlur = () => {
      window.setTimeout(() => clearImageSink(owner.current), 200);
    };
    editor.on("focus", grabSink);
    editor.on("blur", onBlur);
    return () => {
      editor.off("focus", grabSink);
      editor.off("blur", onBlur);
      clearImageSink(owner.current);
    };
  }, [editor]);

  if (!editor) return <div className="rich-editor-shell">{t("editorLoading")}</div>;

  return (
    <div className={`rich-editor ${expanded ? "expanded" : ""}`}>
      <div className="rich-toolbar">
        <button
          type="button"
          tabIndex={-1}
          className={editor.isActive("bold") ? "on" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          B
        </button>
        <button
          type="button"
          tabIndex={-1}
          className={editor.isActive("italic") ? "on" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          I
        </button>
        <button
          type="button"
          tabIndex={-1}
          className={editor.isActive("heading", { level: 2 }) ? "on" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H
        </button>
        <button
          type="button"
          tabIndex={-1}
          className={editor.isActive("bulletList") ? "on" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          •
        </button>
        <button
          type="button"
          tabIndex={-1}
          className={editor.isActive("orderedList") ? "on" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1.
        </button>
        <label className="rich-upload" title={t("photo")}>
          {t("photo")}
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            tabIndex={-1}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void insertRef.current(files);
            }}
          />
        </label>
        {expanded && onCollapse ? (
          <button type="button" tabIndex={-1} className="rich-expand" onClick={onCollapse}>
            {t("done")}
          </button>
        ) : (
          onExpand && (
            <button type="button" tabIndex={-1} className="rich-expand" onClick={onExpand} title={t("expand")} aria-label={t("expand")}>
              <svg className="rich-expand-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M2 2h5v1.5H3.5V7H2V2zm7 0h5v5h-1.5V3.5H9V2zM2 9h1.5v3.5H7V14H2V9zm7 3.5h3.5V9H14v5H9v-1.5z"
                />
              </svg>
            </button>
          )
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
});
