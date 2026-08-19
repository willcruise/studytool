import Image from "@tiptap/extension-image";
import { convertFileSrc } from "@tauri-apps/api/core";

/** Image node that persists the filesystem path, not a one-shot asset URL. */
export const LocalImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      path: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-path"),
        renderHTML: (attrs: { path?: string | null }) =>
          attrs.path ? { "data-path": attrs.path } : {},
      },
    };
  },
});

/** Rewrite <img data-path> src so stored notes still show after reload/expand. */
export function withLiveImageSrc(html: string): string {
  if (!html || !html.includes("<img")) return html;
  try {
    const doc = new DOMParser().parseFromString(`<div class="r">${html}</div>`, "text/html");
    const root = doc.body.firstElementChild;
    if (!root) return html;
    root.querySelectorAll("img").forEach((img) => {
      const path = img.getAttribute("data-path");
      if (path) img.setAttribute("src", convertFileSrc(path));
    });
    return root.innerHTML;
  } catch {
    return html;
  }
}
