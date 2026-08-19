import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";

/** Copies an external file into the app's attachment store; returns stored path. */
export async function importFile(srcPath: string): Promise<string> {
  return invoke<string>("import_file", { srcPath });
}

/** Saves raw bytes (e.g. pasted image) into the attachment store; returns stored path. */
export async function saveBytes(filename: string, data: Uint8Array): Promise<string> {
  return invoke<string>("save_bytes", { filename, bytes: Array.from(data) });
}

export async function openAttachment(path: string): Promise<void> {
  await openPath(path);
}

export function basename(path: string): string {
  const name = path.split("/").pop() ?? path;
  // stored files are prefixed with "<millis>-"; strip it for display
  return name.replace(/^\d{10,}-/, "");
}
