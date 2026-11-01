import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

/**
 * Server-side upload to Vercel Blob.
 *
 * The `BLOB_READ_WRITE_TOKEN` never reaches the browser: the client posts a
 * multipart body here and this route writes it with the server-held token.
 * Without a connected Blob store the route answers 503 and the caller simply
 * skips the archival copy — the workspace itself lives in IndexedDB either way.
 */

export const runtime = "nodejs";

/** Uploaded files are archived copies; keep them from blowing the quota. */
const MAX_BYTES = 25 * 1024 * 1024;

/** Folders and file names must stay inside safe pathname characters. */
function safeSegment(value: string, fallback: string): string {
  const cleaned = value.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "").slice(0, 80);
  return cleaned || fallback;
}

export async function POST(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Blob storage is not connected." },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected a multipart/form-data body." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "The file is empty." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Files up to 25 MB are supported." },
      { status: 413 },
    );
  }

  const spaceId =
    typeof form.get("spaceId") === "string" ? (form.get("spaceId") as string) : "";
  const folder = safeSegment(spaceId, "unsorted");
  const name = safeSegment(file.name, "upload");
  // The timestamp keeps concurrent uploads of the same name from colliding.
  const pathname = `${folder}/${Date.now()}-${name}`;

  try {
    const blob = await put(pathname, file, {
      access: "public",
      token,
      allowOverwrite: true,
      contentType: file.type || undefined,
    });
    return NextResponse.json({
      url: blob.url,
      pathname: blob.pathname,
      size: file.size,
    });
  } catch (error) {
    console.warn(
      "[upload] blob put failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Upload failed." }, { status: 502 });
  }
}
