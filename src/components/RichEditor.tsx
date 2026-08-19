import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import type { Editor } from "@tiptap/react";
import { ingestImageFile, setImageSink, clearImageSink, type StoredImage } from "../images";
import { LocalImage, withLiveImageSrc } from "../localImage";
import { toEditorHtml } from "../richtext";

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

export function RichEditor({
  debtId,
  html,
  placeholder,
  expanded = false,
  onChange,
  onExpand,
  onCollapse,
  onImageInserted,
}: Props) {
  const debtIdRef = useRef(debtId);
  debtIdRef.current = debtId;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onImageInsertedRef = useRef(onImageInserted);
  onImageInsertedRef.current = onImageInserted;
  const insertRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  const owner = useRef(Symbol("editor"));

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      LocalImage.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder }),
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: withLiveImageSrc(toEditorHtml(html)),
    editorProps: {
      attributes: { class: "rich-prose" },
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

  if (!editor) return <div className="rich-editor-shell">에디터 준비 중…</div>;

  return (
    <div className={`rich-editor ${expanded ? "expanded" : ""}`}>
      <div className="rich-toolbar">
        <button
          type="button"
          className={editor.isActive("bold") ? "on" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          B
        </button>
        <button
          type="button"
          className={editor.isActive("italic") ? "on" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          I
        </button>
        <button
          type="button"
          className={editor.isActive("heading", { level: 2 }) ? "on" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H
        </button>
        <button
          type="button"
          className={editor.isActive("bulletList") ? "on" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          •
        </button>
        <button
          type="button"
          className={editor.isActive("orderedList") ? "on" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1.
        </button>
        <label className="rich-upload" title="사진 넣기">
          사진
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void insertRef.current(files);
            }}
          />
        </label>
        {expanded && onCollapse ? (
          <button type="button" className="rich-expand" onClick={onCollapse}>
            완료
          </button>
        ) : (
          onExpand && (
            <button type="button" className="rich-expand" onClick={onExpand} title="크게 쓰기">
              크게 쓰기
            </button>
          )
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
