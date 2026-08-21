import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  open: boolean;
  header?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/** Stays in the panel when collapsed. Fullscreen only portals onto #writer-layer. */
export function EditorDock({ open, header, onClose, children }: Props) {
  const homeRef = useRef<HTMLDivElement>(null);
  const [slotH, setSlotH] = useState(148);
  const layer = typeof document !== "undefined" ? document.getElementById("writer-layer") : null;
  const fullscreen = Boolean(open && layer);

  useLayoutEffect(() => {
    if (open) return;
    const h = homeRef.current?.offsetHeight;
    if (h && h > 0) setSlotH(h);
  }, [open]);

  const dock = (
    <div className={`editor-dock${fullscreen ? " open" : ""}`}>
      {fullscreen ? header : null}
      {children}
    </div>
  );

  return (
    <div
      ref={homeRef}
      className="editor-home"
      style={fullscreen ? { minHeight: slotH } : undefined}
    >
      {fullscreen && layer ? (
        createPortal(
          <>
            <div className="writer-backdrop" onClick={onClose} />
            {dock}
          </>,
          layer
        )
      ) : (
        dock
      )}
    </div>
  );
}
