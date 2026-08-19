import { useEffect, useState } from "react";

interface Props {
  label: string;
  confirmLabel?: string;
  className?: string;
  title?: string;
  onConfirm: () => void;
}

/** Destructive-action button that requires a second click within 3 seconds. */
export function ConfirmButton({
  label,
  confirmLabel = "정말 삭제?",
  className = "danger-btn",
  title,
  onConfirm,
}: Props) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [armed]);

  return (
    <button
      className={`${className} ${armed ? "confirm-armed" : ""}`}
      title={title}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
