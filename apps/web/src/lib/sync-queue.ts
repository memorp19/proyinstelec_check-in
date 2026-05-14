import { v4 as uuidv4 } from "uuid";
import {
  addToQueue,
  getPendingItems,
  updateItem,
  removeItem,
  type SyncItemType,
  type SyncQueueItem,
} from "./idb";

// ── Enqueue ───────────────────────────────────────────────────────────────────

export async function enqueue(type: SyncItemType, payload: unknown): Promise<string> {
  const id = uuidv4();
  await addToQueue({
    id,
    type,
    payload,
    status: "pending",
    attempts: 0,
    createdAt: new Date().toISOString(),
  });
  return id;
}

// ── Flush ─────────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;

/**
 * Processes all pending items in the queue.
 * Calls `sender` for each item. On success: removes it.
 * On failure: increments attempts; marks as error after MAX_ATTEMPTS.
 */
export async function flushQueue(
  sender: (item: SyncQueueItem) => Promise<void>,
): Promise<{ sent: number; failed: number }> {
  const pending = await getPendingItems();
  let sent = 0;
  let failed = 0;

  for (const item of pending) {
    await updateItem(item.id, { status: "syncing" });
    try {
      await sender(item);
      await removeItem(item.id);
      sent++;
    } catch (err) {
      const attempts = item.attempts + 1;
      const newStatus = attempts >= MAX_ATTEMPTS ? "error" : "pending";
      await updateItem(item.id, {
        status: newStatus,
        attempts,
        error: err instanceof Error ? err.message : String(err),
      });
      failed++;
    }
  }

  return { sent, failed };
}

// ── Online event listener ─────────────────────────────────────────────────────

/**
 * Registers a window 'online' listener that auto-flushes the queue.
 * Returns a cleanup function — call it on component unmount.
 */
export function registerOnlineListener(
  sender: (item: SyncQueueItem) => Promise<void>,
): () => void {
  const handler = () => {
    flushQueue(sender).catch(console.error);
  };
  window.addEventListener("online", handler);
  return () => window.removeEventListener("online", handler);
}
