/** Convert stored HTML or legacy plain text into editor HTML. */
export function toEditorHtml(raw: string | null | undefined): string {
  const s = raw ?? "";
  if (!s.trim()) return "";
  if (/<[a-z][\s\S]*>/i.test(s)) return s;
  const escaped = s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<p>${escaped.replace(/\n/g, "<br>")}</p>`;
}

export function htmlToText(html: string | null | undefined): string {
  const s = html ?? "";
  if (!s.trim()) return "";
  return s
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export const CHECK_MIN_CHARS = 20;

export function checkIsReady(html: string | null | undefined): boolean {
  return htmlToText(html).length >= CHECK_MIN_CHARS;
}

export function checkExcerpt(html: string | null | undefined, max = 220): string {
  const t = htmlToText(html);
  return t.length <= max ? t : t.slice(0, max).trimEnd() + "…";
}
