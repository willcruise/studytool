import { listen } from "@tauri-apps/api/event";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const PREF_KEY = "studymap.digFloat";
const POS_KEY = "studymap.digFloatPos";
const MARGIN = 16;

export function digFloatEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDigFloatEnabled(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function readSavedPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof v.x !== "number" || typeof v.y !== "number") return null;
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
    return { x: v.x, y: v.y };
  } catch {
    return null;
  }
}

export function rememberDigWindowPos(x: number, y: number) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ x, y }));
  } catch {
    /* ignore */
  }
}

async function placeDigWindow(w: WebviewWindow) {
  const size = await w.outerSize();
  const monitor = (await currentMonitor()) ?? (await primaryMonitor());
  if (!monitor) return;
  const minX = monitor.position.x + MARGIN;
  const minY = monitor.position.y + MARGIN;
  const maxX = monitor.position.x + monitor.size.width - size.width - MARGIN;
  const maxY = monitor.position.y + monitor.size.height - size.height - MARGIN;
  const saved = readSavedPos();
  const x = saved ? Math.min(maxX, Math.max(minX, saved.x)) : Math.max(minX, maxX);
  const y = saved ? Math.min(maxY, Math.max(minY, saved.y)) : minY;
  await w.setPosition(new PhysicalPosition(x, y));
}

export async function setDigWindowVisible(visible: boolean): Promise<boolean> {
  try {
    const w = await WebviewWindow.getByLabel("dig");
    if (!w) return false;
    if (visible) {
      await placeDigWindow(w);
      await w.show();
      await w.setFocus();
    } else {
      await w.hide();
    }
    return true;
  } catch {
    return false;
  }
}

/** Only the timer/title strip should move the window — never the buttons. */
export function startDigWindowDrag(e: { button: number; target: EventTarget | null }) {
  if (e.button !== 0) return;
  const node = e.target;
  const el = node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
  if (el?.closest("button")) return;
  void getCurrentWindow().startDragging();
}

export function subscribeDigWidgetEvents(handlers: {
  onFinishEarly: () => void;
  onDock: () => void;
}): () => void {
  const unFinish = listen("dig-finish-early", handlers.onFinishEarly);
  const unDock = listen("dig-dock", handlers.onDock);
  return () => {
    unFinish.then((fn) => fn());
    unDock.then((fn) => fn());
  };
}
