import { head, put } from "@vercel/blob";
import { NextResponse } from "next/server";

/**
 * Server-side workspace snapshot on Vercel Blob.
 *
 * The browser serializes its workspace (Spaces, documents, chunks, chats) and
 * posts it here; the route stores it as one JSON file under
 * `workspace-sync/<key>.json`, where <key> is a hash of the account email.
 * Because the key is stable per email (not per browser), a new device signs
 * in and pulls the same workspace back — this is the "cloud" half of the
 * persistence story while Supabase is not configured.
 *
 * Without BLOB_READ_WRITE_TOKEN the route answers 503 and callers treat the
 * mirror as unavailable — the local workspace keeps working either way.
 */

export const runtime = "nodejs";

/** One JSON file per account; refuse payloads beyond a sane size. */
const MAX_BYTES = 48 * 1024 * 1024;

function isSafeKey(key: unknown): key is string {
  return typeof key === "string" && /^[a-f0-9]{16,64}$/.test(key);
}

export async function POST(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Blob storage is not connected." },
      { status: 503 },
    );
  }

  let body: { key?: unknown; data?: unknown };
  try {
    body = (await request.json()) as { key?: unknown; data?: unknown };
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (!isSafeKey(body.key)) {
    return NextResponse.json({ error: "Invalid snapshot key." }, { status: 400 });
  }
  if (typeof body.data !== "string" || body.data.length === 0) {
    return NextResponse.json({ error: "Missing snapshot data." }, { status: 400 });
  }
  if (body.data.length > MAX_BYTES) {
    return NextResponse.json(
      { error: "Snapshot exceeds the size cap." },
      { status: 413 },
    );
  }

  const pathname = `workspace-sync/${body.key}.json`;
  try {
    const blob = await put(pathname, body.data, {
      access: "public",
      token,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return NextResponse.json({
      url: blob.url,
      pathname: blob.pathname,
      size: body.data.length,
      savedAt: Date.now(),
    });
  } catch (error) {
    console.warn(
      "[cloud-snapshot] blob put failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Snapshot storage failed." },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Blob storage is not connected." },
      { status: 503 },
    );
  }

  const key = new URL(request.url).searchParams.get("key");
  if (!isSafeKey(key)) {
    return NextResponse.json({ error: "Invalid snapshot key." }, { status: 400 });
  }

  const pathname = `workspace-sync/${key}.json`;
  try {
    const meta = await head(pathname, { token });
    const response = await fetch(meta.url, { cache: "no-store" });
    if (!response.ok) {
      return NextResponse.json(
        { error: "Snapshot unreadable." },
        { status: 502 },
      );
    }
    return new Response(await response.text(), {
      headers: { "content-type": "application/json" },
    });
  } catch {
    // head throws when the snapshot does not exist yet — a normal cold start.
    return NextResponse.json({ error: "No snapshot stored." }, { status: 404 });
  }
}
