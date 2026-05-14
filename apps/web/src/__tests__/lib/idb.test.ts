import { describe, it, expect, beforeEach } from "vitest";
// fake-indexeddb/auto is loaded in vitest.setup.ts — no extra import needed
import {
  addToQueue,
  getPendingItems,
  getAllItems,
  updateItem,
  removeItem,
  countPending,
  _resetDB,
} from "@/src/lib/idb";
import type { SyncQueueItem } from "@/src/lib/idb";

function makeItem(id: string, overrides: Partial<SyncQueueItem> = {}): SyncQueueItem {
  return {
    id,
    type: "checkin",
    payload: { proyectoId: "p1" },
    status: "pending",
    attempts: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(async () => {
  await _resetDB();
});

describe("addToQueue / getAllItems", () => {
  it("stores an item and retrieves it", async () => {
    await addToQueue(makeItem("item-1"));
    const all = await getAllItems();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("item-1");
  });

  it("stores multiple items", async () => {
    await addToQueue(makeItem("a"));
    await addToQueue(makeItem("b"));
    const all = await getAllItems();
    expect(all).toHaveLength(2);
  });

  it("overwrites an existing item (upsert)", async () => {
    await addToQueue(makeItem("dup", { attempts: 0 }));
    await addToQueue(makeItem("dup", { attempts: 1 }));
    const all = await getAllItems();
    expect(all).toHaveLength(1);
    expect(all[0].attempts).toBe(1);
  });
});

describe("getPendingItems", () => {
  it("returns only pending items", async () => {
    await addToQueue(makeItem("p1", { status: "pending" }));
    await addToQueue(makeItem("d1", { status: "done" }));
    await addToQueue(makeItem("e1", { status: "error" }));

    const pending = await getPendingItems();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("p1");
  });

  it("returns empty array when queue is empty", async () => {
    const pending = await getPendingItems();
    expect(pending).toEqual([]);
  });
});

describe("updateItem", () => {
  it("updates status and attempts", async () => {
    await addToQueue(makeItem("upd-1", { status: "pending", attempts: 0 }));
    await updateItem("upd-1", { status: "error", attempts: 1, error: "Network error" });

    const all = await getAllItems();
    expect(all[0].status).toBe("error");
    expect(all[0].attempts).toBe(1);
    expect(all[0].error).toBe("Network error");
  });

  it("is a no-op for non-existent id", async () => {
    await expect(updateItem("ghost", { status: "done" })).resolves.toBeUndefined();
  });
});

describe("removeItem", () => {
  it("deletes the item", async () => {
    await addToQueue(makeItem("del-1"));
    await removeItem("del-1");
    const all = await getAllItems();
    expect(all).toHaveLength(0);
  });

  it("is a no-op when item does not exist", async () => {
    await expect(removeItem("ghost")).resolves.toBeUndefined();
  });
});

describe("countPending", () => {
  it("returns 0 for empty queue", async () => {
    expect(await countPending()).toBe(0);
  });

  it("counts only pending items", async () => {
    await addToQueue(makeItem("a", { status: "pending" }));
    await addToQueue(makeItem("b", { status: "pending" }));
    await addToQueue(makeItem("c", { status: "done" }));
    expect(await countPending()).toBe(2);
  });
});
