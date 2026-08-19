import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const KEY = "studymap.digFloat";

export function digFloatEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setDigFloatEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export async function setDigWindowVisible(visible: boolean): Promise<boolean> {
  try {
    const w = await WebviewWindow.getByLabel("dig");
    if (!w) return false;
    if (visible) await w.show();
    else await w.hide();
    return true;
  } catch {
    return false;
  }
}
