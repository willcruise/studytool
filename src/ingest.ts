import type { Debt } from "./types";
import * as db from "./db";
import { getImageSink, ingestImageFile, ingestImagePath, isImagePath } from "./images";
import { importFile, isPaperPath, titleFromFilename } from "./files";
import { t } from "./i18n";

export interface IngestCtx {
  selectedId: number | null;
  sessionId: number | null;
  debts: Debt[];
}

export interface IngestResult {
  toast: string;
  refresh: boolean;
  bumpAttachments: boolean;
}

export async function ingestDroppedPaths(
  paths: string[],
  ctx: IngestCtx
): Promise<IngestResult> {
  const sink = getImageSink();
  let inserted = 0;
  let attached = 0;
  let papers = 0;
  const targetId = ctx.selectedId;

  for (const p of paths) {
    if (isPaperPath(p)) {
      const stored = await importFile(p);
      if (targetId !== null) {
        const current = ctx.debts.find((d) => d.id === targetId);
        if (current?.source_file) {
          await db.addAttachment(targetId, p.split("/").pop() ?? "file", stored);
          attached += 1;
        } else {
          await db.updateDebt(targetId, { source_file: stored });
          papers += 1;
        }
      } else {
        await db.createDebt({
          title: titleFromFilename(p),
          tier: "inbox",
          sessionId: ctx.sessionId,
          sourceFile: stored,
        });
        papers += 1;
      }
      continue;
    }

    if (sink && targetId !== null && isImagePath(p)) {
      const stored = await ingestImagePath(targetId, p);
      if (stored) {
        sink(stored);
        inserted += 1;
        continue;
      }
    }

    const stored = await importFile(p);
    const filename = p.split("/").pop() ?? "file";
    if (targetId !== null) {
      await db.addAttachment(targetId, filename, stored);
    } else {
      const id = await db.createDebt({
        title: filename,
        tier: "inbox",
        sessionId: ctx.sessionId,
      });
      await db.addAttachment(id, filename, stored);
    }
    attached += 1;
  }

  return {
    refresh: attached > 0 || papers > 0,
    bumpAttachments: true,
    toast:
      papers > 0
        ? t("papersAttached", { n: papers })
        : inserted > 0
          ? t("photosInEditor", { n: inserted })
          : targetId !== null
            ? t("filesAttached", { n: attached })
            : t("filesInbox", { n: paths.length }),
  };
}

export async function ingestPastedImage(file: File, ctx: IngestCtx): Promise<IngestResult> {
  const targetId = ctx.selectedId;
  const sink = getImageSink();
  if (sink && targetId !== null) {
    const stored = await ingestImageFile(targetId, file);
    sink(stored);
    return { toast: t("photoInEditor"), refresh: false, bumpAttachments: true };
  }
  if (targetId !== null) {
    await ingestImageFile(targetId, file);
    return {
      toast: t("imageAttached"),
      refresh: true,
      bumpAttachments: true,
    };
  }
  const id = await db.createDebt({
    title: t("pastedImage"),
    tier: "inbox",
    sessionId: ctx.sessionId,
  });
  await ingestImageFile(id, file);
  return {
    toast: t("imageInbox"),
    refresh: true,
    bumpAttachments: true,
  };
}

export function pasteTargetIsEditor(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable ||
    !!target.closest?.("[contenteditable='true'], .rich-editor")
  );
}
