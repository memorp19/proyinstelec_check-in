import { openDB, deleteDB, type DBSchema, type IDBPDatabase } from "idb";

// ── Schema ────────────────────────────────────────────────────────────────────

export type SyncItemType = "checkin" | "checkout" | "evidencia";
export type SyncItemStatus = "pending" | "syncing" | "done" | "error";

export interface SyncQueueItem {
  id: string;
  type: SyncItemType;
  payload: unknown;
  status: SyncItemStatus;
  attempts: number;
  createdAt: string; // ISO
  error?: string;
}

interface ProyinstelecDB extends DBSchema {
  "sync-queue": {
    key: string;
    value: SyncQueueItem;
    indexes: { "by-status": SyncItemStatus };
  };
}

// ── Database open ─────────────────────────────────────────────────────────────

let _db: IDBPDatabase<ProyinstelecDB> | null = null;

async function getDB(): Promise<IDBPDatabase<ProyinstelecDB>> {
  if (!_db) {
    _db = await openDB<ProyinstelecDB>("proyinstelec", 1, {
      upgrade(db) {
        const store = db.createObjectStore("sync-queue", { keyPath: "id" });
        store.createIndex("by-status", "status");
      },
    });
  }
  return _db;
}

/** Exposed for test teardown — closes and deletes the database so each test starts fresh. */
export async function _resetDB(): Promise<void> {
  if (_db) {
    _db.close();
    _db = null;
  }
  await deleteDB("proyinstelec");
}

// ── CRUD helpers ──────────────────────────────────────────────────────────────

export async function addToQueue(item: SyncQueueItem): Promise<void> {
  const db = await getDB();
  await db.put("sync-queue", item);
}

export async function getPendingItems(): Promise<SyncQueueItem[]> {
  const db = await getDB();
  return db.getAllFromIndex("sync-queue", "by-status", "pending");
}

export async function getAllItems(): Promise<SyncQueueItem[]> {
  const db = await getDB();
  return db.getAll("sync-queue");
}

export async function updateItem(
  id: string,
  patch: Partial<Pick<SyncQueueItem, "status" | "attempts" | "error">>,
): Promise<void> {
  const db = await getDB();
  const item = await db.get("sync-queue", id);
  if (!item) return;
  await db.put("sync-queue", { ...item, ...patch });
}

export async function removeItem(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("sync-queue", id);
}

export async function countPending(): Promise<number> {
  const items = await getPendingItems();
  return items.length;
}
