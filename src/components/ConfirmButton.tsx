import { useEffect, useState } from "react";

import { useI18n } from "../i18n";

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
  confirmLabel,
  className = "danger-btn",
  title,
  onConfirm,
}: Props) {
  const { t } = useI18n();
  const confirm = confirmLabel ?? t("confirmDelete");
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
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
      {armed ? confirm : label}
    </button>
  );
}
