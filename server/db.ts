import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { DB_FILE } from "./paths.ts";

let db: DatabaseSync;

export const getRaw = () => db;

export function openDb() {
  db = new DatabaseSync(DB_FILE);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS records (
      module TEXT NOT NULL,
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (module, collection, id)
    );
    CREATE TABLE IF NOT EXISTS kv (
      module TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (module, key)
    );
    CREATE TABLE IF NOT EXISTS files (
      module TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (module, id)
    );
  `);
  return db;
}

export interface Doc {
  id: string;
  createdAt: number;
  updatedAt: number;
  [k: string]: unknown;
}

const toDoc = (r: any): Doc => ({ ...JSON.parse(r.data), id: r.id, createdAt: r.created_at, updatedAt: r.updated_at });

export const newId = () => Date.now().toString(36) + crypto.randomBytes(5).toString("hex");

function strip(data: Record<string, unknown>) {
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = data;
  return rest;
}

export function listDocs(module: string, collection: string): Doc[] {
  return db
    .prepare("SELECT * FROM records WHERE module = ? AND collection = ? ORDER BY created_at")
    .all(module, collection)
    .map(toDoc);
}

export function getDoc(module: string, collection: string, id: string): Doc | null {
  const r = db.prepare("SELECT * FROM records WHERE module = ? AND collection = ? AND id = ?").get(module, collection, id);
  return r ? toDoc(r) : null;
}

export function putDoc(module: string, collection: string, id: string | undefined, data: Record<string, unknown>, merge: boolean): Doc {
  const now = Date.now();
  const docId = id || newId();
  const existing = id ? getDoc(module, collection, docId) : null;
  const body = merge && existing ? { ...strip(existing), ...strip(data) } : strip(data);
  db.prepare(
    `INSERT INTO records (module, collection, id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (module, collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(module, collection, docId, JSON.stringify(body), existing?.createdAt ?? now, now);
  return getDoc(module, collection, docId)!;
}

export function deleteDoc(module: string, collection: string, id: string) {
  db.prepare("DELETE FROM records WHERE module = ? AND collection = ? AND id = ?").run(module, collection, id);
}

export function clearCollection(module: string, collection: string) {
  db.prepare("DELETE FROM records WHERE module = ? AND collection = ?").run(module, collection);
}

export function getKv(module: string, key: string): unknown {
  const r = db.prepare("SELECT value FROM kv WHERE module = ? AND key = ?").get(module, key) as any;
  return r ? JSON.parse(r.value) : undefined;
}

export function allKv(module: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of db.prepare("SELECT key, value FROM kv WHERE module = ?").all(module) as any[]) out[r.key] = JSON.parse(r.value);
  return out;
}

export function setKv(module: string, key: string, value: unknown) {
  if (value === undefined || value === null) {
    db.prepare("DELETE FROM kv WHERE module = ? AND key = ?").run(module, key);
    return;
  }
  db.prepare(
    `INSERT INTO kv (module, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (module, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(module, key, JSON.stringify(value), Date.now());
}

export interface FileMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
}

export function addFileMeta(module: string, meta: FileMeta) {
  db.prepare("INSERT INTO files (module, id, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    module, meta.id, meta.name, meta.mime, meta.size, meta.createdAt,
  );
}

export function listFiles(module: string): FileMeta[] {
  return db
    .prepare("SELECT * FROM files WHERE module = ? ORDER BY created_at DESC")
    .all(module)
    .map((r: any) => ({ id: r.id, name: r.name, mime: r.mime, size: r.size, createdAt: r.created_at }));
}

export function getFileMeta(module: string, id: string): FileMeta | null {
  const r = db.prepare("SELECT * FROM files WHERE module = ? AND id = ?").get(module, id) as any;
  return r ? { id: r.id, name: r.name, mime: r.mime, size: r.size, createdAt: r.created_at } : null;
}

export function deleteFileMeta(module: string, id: string) {
  db.prepare("DELETE FROM files WHERE module = ? AND id = ?").run(module, id);
}

/** Статистика хранилища модуля: коллекции и число записей. */
export function moduleStats(module: string) {
  const collections = db
    .prepare("SELECT collection, COUNT(*) AS n FROM records WHERE module = ? GROUP BY collection")
    .all(module) as { collection: string; n: number }[];
  const files = (db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS s FROM files WHERE module = ?").get(module) as any);
  return { collections, files: files.n as number, filesBytes: files.s as number };
}

export function purgeModuleData(module: string) {
  db.prepare("DELETE FROM records WHERE module = ?").run(module);
  db.prepare("DELETE FROM kv WHERE module = ?").run(module);
  db.prepare("DELETE FROM files WHERE module = ?").run(module);
}

/** Консистентная копия базы для бэкапа. */
export function snapshotDb(target: string) {
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
}
