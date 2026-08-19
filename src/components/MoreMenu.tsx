import { useEffect, useRef, useState, type ReactNode } from "react";

import { useI18n } from "../i18n";

interface Props {
  children: ReactNode;
  title?: string;
}

/** Quiet overflow toggle for infrequent actions. Add more items as children. */
export function MoreMenu({ children, title }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="more-menu" ref={rootRef}>
      <button
        type="button"
        className={`more-menu-trigger${open ? " open" : ""}`}
        title={title ?? t("more")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className="more-menu-list" role="menu">
          {children}
        </div>
      )}
    </div>
  );
}
