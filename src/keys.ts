import type { KeyboardEvent } from "react";

const TAB = "\t";

function indentLine(line: string): string {
  return TAB + line;
}

function outdentLine(line: string): string {
  if (line.startsWith(TAB)) return line.slice(1);
  if (line.startsWith("  ")) return line.slice(2);
  if (line.startsWith(" ")) return line.slice(1);
  return line;
}

function lineBounds(value: string, start: number, end: number): { from: number; to: number } {
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const nl = value.indexOf("\n", end);
  return { from, to: nl === -1 ? value.length : nl };
}

export function autosizeTextarea(el: HTMLTextAreaElement | null, maxPx: number) {
  if (!el) return;
  el.style.height = "0px";
  el.style.height = `${Math.min(maxPx, el.scrollHeight)}px`;
}

/** Tab indents (Shift+Tab outdents) instead of moving focus. */
export function handleTextareaTab(
  e: KeyboardEvent<HTMLTextAreaElement>,
  value: string,
  setValue: (next: string) => void,
): boolean {
  if (e.key !== "Tab" || e.nativeEvent.isComposing) return false;
  e.preventDefault();

  const el = e.currentTarget;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const selected = value.slice(start, end);
  const multiline = selected.includes("\n");

  if (!e.shiftKey && !multiline) {
    const next = value.slice(0, start) + TAB + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + TAB.length;
    });
    return true;
  }

  const { from, to } = lineBounds(value, start, end);
  const block = value.slice(from, to);
  const transform = e.shiftKey ? outdentLine : indentLine;
  const lines = block.split("\n");
  const nextLines = lines.map(transform);
  const nextBlock = nextLines.join("\n");
  if (nextBlock === block) return true;

  const next = value.slice(0, from) + nextBlock + value.slice(to);
  const firstDelta = (nextLines[0] ?? "").length - (lines[0] ?? "").length;
  const delta = nextBlock.length - block.length;
  setValue(next);
  requestAnimationFrame(() => {
    el.selectionStart = Math.max(from, start + firstDelta);
    el.selectionEnd = end + delta;
  });
  return true;
}
