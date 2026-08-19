/** Capture-box parsing. Extra lines stay in the title unless the first line is a URL. */
export function parseInput(raw: string): { title: string; sourceUrl: string | null; note: string } {
  const text = raw.replace(/\s+$/, "");
  const nl = text.indexOf("\n");
  const first = (nl === -1 ? text : text.slice(0, nl)).trim();
  const rest = nl === -1 ? "" : text.slice(nl + 1).trim();
  if (/^https?:\/\/\S+$/.test(first)) {
    try {
      const u = new URL(first);
      const title = decodeURIComponent(u.hostname + u.pathname).replace(/\/$/, "");
      return { title, sourceUrl: first, note: rest };
    } catch {
      /* fall through */
    }
  }
  return { title: text.replace(/\s+/g, " ").trim(), sourceUrl: null, note: "" };
}
