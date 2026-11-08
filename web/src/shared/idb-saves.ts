import { HostError, type Replay, type SaveMeta } from "./protocol.ts";
import type { SaveStore } from "./runtime.ts";

const DB_NAME = "lantern-eve";
const DB_VERSION = 1;
const SAVES = "saves";
const REPLAYS = "replays";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SAVES)) {
        db.createObjectStore(SAVES, { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(REPLAYS)) {
        db.createObjectStore(REPLAYS, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("could not open IndexedDB"));
    req.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
  });
}

/**
 * Saves in IndexedDB. A save is a replay, and the replay sits in its own store so that listing
 * the saves reads only their small records. The page opens the same database as the host worker, for
 * the gallery of recordings, and creates the stores the same way if it is the first to open it.
 */
export class IdbSaveStore implements SaveStore {
  private db: Promise<IDBDatabase> | null = null;

  private connection(): Promise<IDBDatabase> {
    this.db ??= open().catch((err: unknown) => {
      this.db = null;
      throw new HostError("storage", `IndexedDB is not available: ${String(err)}`);
    });
    return this.db;
  }

  async put(meta: Omit<SaveMeta, "id">, replay: Replay): Promise<SaveMeta> {
    const db = await this.connection();
    const tx = db.transaction([SAVES, REPLAYS], "readwrite");
    const done = finished(tx);
    const id = (await request(tx.objectStore(SAVES).add({ ...meta }))) as number;
    tx.objectStore(REPLAYS).put({ id, replay });
    await done;
    return { id, ...meta };
  }

  async list(): Promise<SaveMeta[]> {
    const db = await this.connection();
    const rows = (await request(db.transaction(SAVES, "readonly").objectStore(SAVES).getAll())) as SaveMeta[];
    return rows.sort((a, b) => b.id - a.id);
  }

  async get(id: number): Promise<{ meta: SaveMeta; replay: unknown } | undefined> {
    const db = await this.connection();
    const tx = db.transaction([SAVES, REPLAYS], "readonly");
    const meta = (await request(tx.objectStore(SAVES).get(id))) as SaveMeta | undefined;
    const row = (await request(tx.objectStore(REPLAYS).get(id))) as { id: number; replay: unknown } | undefined;
    if (meta === undefined || row === undefined) return undefined;
    return { meta, replay: row.replay };
  }

  async remove(id: number): Promise<void> {
    const db = await this.connection();
    const tx = db.transaction([SAVES, REPLAYS], "readwrite");
    const done = finished(tx);
    tx.objectStore(SAVES).delete(id);
    tx.objectStore(REPLAYS).delete(id);
    await done;
  }
}
