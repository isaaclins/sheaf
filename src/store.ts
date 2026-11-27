// Every note is one JSON file. On desktop and mobile they live in Documents/Sheaf,
// so any sync tool (iCloud, Dropbox, Syncthing, git) can carry them. In a browser
// they live in IndexedDB.
import * as idb from "idb-keyval";
import { BaseDirectory, mkdir, readDir, readTextFile, remove as rm, writeTextFile } from "@tauri-apps/plugin-fs";

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
  return Promise.all(files.map(async (f) => JSON.parse(await readTextFile(`${DIR}/${f.name}`, opts))));
}

export async function save(doc: Doc) {
  if (!native) return idb.set(doc.id, doc);
  await writeTextFile(`${DIR}/${doc.id}.json`, JSON.stringify(doc), opts);
}

export async function remove(id: string) {
  if (!native) return idb.del(id);
  await rm(`${DIR}/${id}.json`, opts);
}

export const newId = () => crypto.randomUUID().slice(0, 8);
