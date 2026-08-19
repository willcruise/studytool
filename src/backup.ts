import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export async function exportBackup(): Promise<boolean> {
  const dest = await save({
    defaultPath: "studymap-backup.zip",
    filters: [{ name: "Zip", extensions: ["zip"] }],
  });
  if (!dest) return false;
  await invoke("export_backup", { destPath: dest });
  return true;
}

export async function importBackup(): Promise<boolean> {
  const src = await open({
    multiple: false,
    filters: [{ name: "Zip", extensions: ["zip"] }],
  });
  if (!src || Array.isArray(src)) return false;
  await invoke("import_backup", { srcPath: src });
  return true;
}
