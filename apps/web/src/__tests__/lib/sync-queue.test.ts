import { describe, it, expect, vi, beforeEach } from "vitest";
import { _resetDB, getAllItems } from "@/src/lib/idb";
import { enqueue, flushQueue } from "@/src/lib/sync-queue";

beforeEach(async () => { await _resetDB(); });

describe("enqueue", () => {
  it("adds an item with status pending and returns an id", async () => {
    const id = await enqueue("checkin", { proyectoId: "p1" });
    expect(id).toBeTruthy();
    const all = await getAllItems();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("pending");
    expect(all[0].type).toBe("checkin");
  });

  it("generates unique ids for each call", async () => {
    const id1 = await enqueue("checkin", {});
    const id2 = await enqueue("checkin", {});
    expect(id1).not.toBe(id2);
  });
});

describe("flushQueue", () => {
  it("sends all pending items and removes them on success", async () => {
    await enqueue("checkin", { a: 1 });
    await enqueue("checkout", { b: 2 });

    const sender = vi.fn().mockResolvedValue(undefined);
    const result = await flushQueue(sender);

    expect(sender).toHaveBeenCalledTimes(2);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(await getAllItems()).toHaveLength(0);
  });

  it("keeps item as pending after first failure (attempts < MAX_ATTEMPTS)", async () => {
    await enqueue("checkin", { x: 1 });

    const sender = vi.fn().mockRejectedValue(new Error("Network down"));
    await flushQueue(sender);

    const items = await getAllItems();
    expect(items[0].status).toBe("pending");
    expect(items[0].attempts).toBe(1);
    expect(items[0].error).toBe("Network down");
  });

  it("marks item as error after MAX_ATTEMPTS (3) failures", async () => {
    await enqueue("checkin", { x: 1 });
    const sender = vi.fn().mockRejectedValue(new Error("fail"));

    // Simulate 3 flush attempts
    await flushQueue(sender);
    await flushQueue(sender);
    await flushQueue(sender);

    const items = await getAllItems();
    expect(items[0].status).toBe("error");
    expect(items[0].attempts).toBe(3);
  });

  it("does not call sender when queue is empty", async () => {
    const sender = vi.fn();
    const result = await flushQueue(sender);
    expect(sender).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  it("processes successful and failed items independently", async () => {
    await enqueue("checkin", { id: "good" });
    await enqueue("checkout", { id: "bad" });

    const sender = vi.fn().mockImplementation(async (item: any) => {
      if ((item.payload as any).id === "bad") throw new Error("bad one");
    });

    const result = await flushQueue(sender);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);

    const remaining = await getAllItems();
    expect(remaining).toHaveLength(1);
    expect((remaining[0].payload as any).id).toBe("bad");
  });
});
