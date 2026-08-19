import { convertFileSrc } from "@tauri-apps/api/core";
import { addAttachment } from "./db";
import { importFile, saveBytes } from "./files";

export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(path);
}

export interface StoredImage {
  path: string;
  filename: string;
  src: string;
}

export async function ingestImageFile(
  debtId: number,
  file: File
): Promise<StoredImage> {
  const filename = file.name || `pasted.${file.type.split("/")[1] || "png"}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const path = await saveBytes(filename, bytes);
  await addAttachment(debtId, filename, path);
  return { path, filename, src: convertFileSrc(path) };
}

export async function ingestImagePath(
  debtId: number,
  srcPath: string
): Promise<StoredImage | null> {
  if (!isImagePath(srcPath)) return null;
  const path = await importFile(srcPath);
  const filename = srcPath.split("/").pop() ?? "image.png";
  await addAttachment(debtId, filename, path);
  return { path, filename, src: convertFileSrc(path) };
}

type ImageSink = (img: StoredImage) => void;
let imageSink: ImageSink | null = null;
let sinkOwner: symbol | null = null;

export function setImageSink(fn: ImageSink, owner: symbol) {
  imageSink = fn;
  sinkOwner = owner;
}

export function clearImageSink(owner: symbol) {
  if (sinkOwner === owner) {
    imageSink = null;
    sinkOwner = null;
  }
}

export function getImageSink(): ImageSink | null {
  return imageSink;
}
