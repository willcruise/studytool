import type { Debt } from "./types";
import * as db from "./db";
import { getImageSink, ingestImageFile, ingestImagePath, isImagePath } from "./images";
import { importFile, isPaperPath, titleFromFilename } from "./files";

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
        ? `논문 ${papers}개를 출처로 달았습니다`
        : inserted > 0
          ? `사진 ${inserted}장을 에디터에 추가했습니다`
          : targetId !== null
            ? `파일 ${attached}개를 선택된 항목에 첨부했습니다`
            : `파일 ${paths.length}개를 인박스에 추가했습니다`,
  };
}

export async function ingestPastedImage(file: File, ctx: IngestCtx): Promise<IngestResult> {
  const targetId = ctx.selectedId;
  const sink = getImageSink();
  if (sink && targetId !== null) {
    const stored = await ingestImageFile(targetId, file);
    sink(stored);
    return { toast: "사진을 에디터에 넣었습니다", refresh: false, bumpAttachments: true };
  }
  if (targetId !== null) {
    await ingestImageFile(targetId, file);
    return {
      toast: "이미지를 선택된 항목에 첨부했습니다",
      refresh: true,
      bumpAttachments: true,
    };
  }
  const id = await db.createDebt({
    title: "붙여넣은 이미지",
    tier: "inbox",
    sessionId: ctx.sessionId,
  });
  await ingestImageFile(id, file);
  return {
    toast: "이미지를 인박스에 추가했습니다",
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
