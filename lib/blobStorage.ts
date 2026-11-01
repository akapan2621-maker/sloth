/**
 * Vercel Blob file storage.
 *
 * Supabase Storage used to hold the original uploaded files. Storage now runs
 * on Vercel Blob instead: the browser posts the file to `/api/upload`, which
 * writes it with the server-held `BLOB_READ_WRITE_TOKEN`. The RAG corpus
 * itself (text, chunks, embeddings) is unaffected — that still lives in
 * IndexedDB and mirrors to Postgres only when Supabase is configured.
 *
 * Everything degrades to a no-op when the store is not connected, so local
 * development keeps working without any Vercel credentials.
 */

export interface UploadedBlob {
  /** Public URL of the stored file. */
  url: string;
  /** Store pathname, e.g. `space_x/1712345678901-report.pdf`. */
  pathname: string;
  size: number;
}

/**
 * Archives the original file under its Space. Resolves to null when Blob
 * storage is unavailable or the upload fails — callers treat this as
 * optional and never surface it as an error.
 */
export async function uploadFileToBlob(
  spaceId: string,
  file: File,
): Promise<UploadedBlob | null> {
  if (typeof fetch === "undefined" || file.size === 0) return null;

  const form = new FormData();
  form.append("spaceId", spaceId);
  form.append("file", file);

  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      body: form,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<UploadedBlob>;
    return typeof data.url === "string" && typeof data.pathname === "string"
      ? { url: data.url, pathname: data.pathname, size: Number(data.size ?? 0) }
      : null;
  } catch {
    /* offline or endpoint unavailable — archival copy is best-effort */
    return null;
  }
}
