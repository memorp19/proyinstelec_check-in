import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/src/auth", () => ({ authOptions: {} }));
vi.mock("@/src/lib/drive", () => ({ uploadPhoto: vi.fn() }));

import { getServerSession } from "next-auth";
import { uploadPhoto } from "@/src/lib/drive";
import { POST } from "@/app/api/upload/route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  base64: Buffer.from("fake-image").toString("base64"),
  filename: "checkin_0941.jpg",
  mimeType: "image/jpeg",
  proyectoNombre: "Subestación Polanco",
  fecha: "2026-05-14",
  trabajadorNombre: "Carlos Reyes",
};

const UPLOAD_RESULT = {
  driveFileId: "drive-file-123",
  hash: "a".repeat(64),
  webViewLink: "https://drive.google.com/file/d/drive-file-123/view",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: "u1" } } as any);
  vi.mocked(uploadPhoto).mockResolvedValue(UPLOAD_RESULT);
});

describe("POST /api/upload", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it("returns driveFileId, hash, webViewLink and thumbnailUrl on success", async () => {
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.driveFileId).toBe("drive-file-123");
    expect(json.hash).toHaveLength(64);
    expect(json.thumbnailUrl).toContain("drive-file-123");
    expect(json.thumbnailUrl).toContain("sz=w400");
  });

  it("returns 400 when required fields are missing", async () => {
    const { proyectoNombre: _, ...incomplete } = VALID_BODY;
    const res = await POST(makeRequest(incomplete));
    expect(res.status).toBe(400);
  });

  it("returns 413 when image exceeds 8 MB", async () => {
    const bigBase64 = Buffer.alloc(9 * 1024 * 1024).toString("base64");
    const res = await POST(makeRequest({ ...VALID_BODY, base64: bigBase64 }));
    expect(res.status).toBe(413);
  });

  it("returns 415 for unsupported MIME type", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, mimeType: "image/gif" }));
    expect(res.status).toBe(415);
  });

  it("returns 502 when Drive upload fails", async () => {
    vi.mocked(uploadPhoto).mockRejectedValue(new Error("Drive API error"));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(502);
  });

  it("accepts image/png and image/webp MIME types", async () => {
    for (const mimeType of ["image/png", "image/webp"]) {
      const res = await POST(makeRequest({ ...VALID_BODY, mimeType }));
      expect(res.status).toBe(200);
    }
  });

  it("defaults mimeType to image/jpeg when not provided", async () => {
    const { mimeType: _, ...noMime } = VALID_BODY;
    const res = await POST(makeRequest(noMime));
    expect(res.status).toBe(200);
    expect(uploadPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "image/jpeg" }),
    );
  });
});
