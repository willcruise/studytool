import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Debt, Session } from "../types";
import { useI18n } from "../i18n";
import {
  ingestDroppedPaths,
  ingestPastedImage,
  pasteTargetIsEditor,
  type IngestCtx,
} from "../ingest";

interface Args {
  selectedIdRef: { current: number | null };
  activeSessionRef: { current: Session | null };
  allDebtsRef: { current: Debt[] };
  refresh: () => Promise<void>;
  showToast: (msg: string) => void;
}

export function useFileIngest({
  selectedIdRef,
  activeSessionRef,
  allDebtsRef,
  refresh,
  showToast,
}: Args) {
  const { t } = useI18n();
  const [dropActive, setDropActive] = useState(false);
  const [attachmentsVersion, setAttachmentsVersion] = useState(0);
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const ingestCtx = (): IngestCtx => ({
    selectedId: selectedIdRef.current,
    sessionId: activeSessionRef.current?.id ?? null,
    debts: allDebtsRef.current,
  });

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type === "over") {
        setDropActive(true);
      } else if (event.payload.type === "leave") {
        setDropActive(false);
      } else if (event.payload.type === "drop") {
        setDropActive(false);
        try {
          const result = await ingestDroppedPaths(event.payload.paths, ingestCtx());
          if (result.bumpAttachments) setAttachmentsVersion((v) => v + 1);
          if (result.refresh) await refresh();
          showToastRef.current(result.toast);
        } catch (e) {
          showToastRef.current(t("toastFileFail", { error: String(e) }));
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refresh, t]);

  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (pasteTargetIsEditor(e.target)) return;
      const items = e.clipboardData?.items ?? [];
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const result = await ingestPastedImage(file, ingestCtx());
          if (result.bumpAttachments) setAttachmentsVersion((v) => v + 1);
          if (result.refresh) await refresh();
          showToastRef.current(result.toast);
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [refresh]);

  return { dropActive, attachmentsVersion };
}
