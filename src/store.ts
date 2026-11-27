// Every note is one JSON file. On desktop and mobile they live in Documents/Sheaf,
// so any sync tool (iCloud, Dropbox, Syncthing, git) can carry them. In a browser
// they live in IndexedDB.
import * as idb from "idb-keyval";
import { BaseDirectory, documentDir, join } from "@tauri-apps/api/path";
import { mkdir, readDir, readTextFile, remove as rm, rename, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { openPath } from "@tauri-apps/plugin-opener";

export type Doc = {
  id: string; // "2026-11-27" for daily notes, random otherwise
  kind: "day" | "doc" | "template";
  title: string;
  parent?: string;
  blocks: any[];
  updated: number;
};

const native = "__TAURI_INTERNALS__" in window;
const opts = { baseDir: BaseDirectory.Document };
const DIR = "Sheaf";

export async function loadAll(): Promise<Doc[]> {
  if (!native) return (await idb.values()) as Doc[];
  await mkdir(DIR, { ...opts, recursive: true });
  const files = (await readDir(DIR, opts)).filter((f) => f.name.endsWith(".json"));
  const docs = await Promise.all(
    files.map((f) => readTextFile(`${DIR}/${f.name}`, opts).then(JSON.parse).catch(() => null)), // skip broken files
  );
  return docs.filter(Boolean);
}

export async function save(doc: Doc) {
  if (!native) return idb.set(doc.id, doc);
  // Write a temp file, then swap it in, so a failed write never damages the saved note.
  await writeTextFile(`${DIR}/${doc.id}.json.tmp`, JSON.stringify(doc), opts);
  await rename(`${DIR}/${doc.id}.json.tmp`, `${DIR}/${doc.id}.json`, { oldPathBaseDir: opts.baseDir, newPathBaseDir: opts.baseDir });
}

export async function remove(id: string) {
  if (!native) return idb.del(id);
  await rm(`${DIR}/${id}.json`, opts);
}

export const newId = () => crypto.randomUUID().slice(0, 8);

// Attachments are stored inside the note as data URLs that carry the file name.
export const toDataUrl = (f: File) =>
  new Promise<string>((ok) => {
    const r = new FileReader();
    r.onload = () => ok((r.result as string).replace(";base64,", `;name=${encodeURIComponent(f.name)};base64,`));
    r.readAsDataURL(f);
  });

// The editor opens attachments with window.open, which can't show data URLs. Save them instead.
export async function openAttachment(url: string) {
  const name = decodeURIComponent(url.match(/;name=([^;,]+)/)?.[1] ?? "attachment").replace(/[\\/]/g, "_");
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  if (!native) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes]));
    a.download = name;
    a.click();
    return;
  }
  await mkdir(`${DIR}/files`, { ...opts, recursive: true });
  await writeFile(`${DIR}/files/${name}`, bytes, opts);
  await openPath(await join(await documentDir(), DIR, "files", name));
}
