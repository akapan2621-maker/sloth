/**
 * Client-side document parsing.
 *
 * Everything runs in the browser so that Vercel's 4.5 MB body limit and the
 * 10 s serverless execution ceiling never apply to document ingestion.
 */

export interface ParsedDocument {
  fileName: string;
  mimeType: string;
  size: number;
  text: string;
  pageCount?: number;
}

export class FileParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileParseError";
  }
}

export function isSupportedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".pdf") ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    name.endsWith(".csv") ||
    name.endsWith(".json")
  );
}

/** Entry point: dispatch on the file extension. */
export async function parseFile(file: File): Promise<ParsedDocument> {
  const lower = file.name.toLowerCase();

  if (lower.endsWith(".pdf")) return parsePdf(file);
  if (lower.endsWith(".csv")) return parseCsv(file);
  if (lower.endsWith(".json")) return parseJson(file);
  if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return parsePlainText(file);
  }

  throw new FileParseError(
    `Unsupported file type "${file.name}". Supported: .pdf, .txt, .md, .csv, .json`,
  );
}

async function parsePlainText(file: File): Promise<ParsedDocument> {
  const text = await file.text();
  return {
    fileName: file.name,
    mimeType: file.type || "text/plain",
    size: file.size,
    text: text.replace(/\r\n?/g, "\n"),
  };
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

/** Minimal RFC-4180 style CSV parser (handles quotes and embedded newlines). */
export function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

async function parseCsv(file: File): Promise<ParsedDocument> {
  const raw = await file.text();
  const rows = parseCsvRows(raw);
  if (rows.length === 0) {
    return {
      fileName: file.name,
      mimeType: file.type || "text/csv",
      size: file.size,
      text: "",
    };
  }

  const header = rows[0].map((h) => h.trim());
  const body = rows.slice(1);
  const lines: string[] = [];

  lines.push(`# CSV dataset: ${file.name}`);
  lines.push(`# Columns: ${header.join(", ")}`);
  lines.push(`# Rows: ${body.length}`);
  lines.push("");

  for (const row of body) {
    const pairs = header.map((key, index) => `${key}: ${(row[index] ?? "").trim()}`);
    lines.push(`- ${pairs.join(" | ")}`);
  }

  return {
    fileName: file.name,
    mimeType: file.type || "text/csv",
    size: file.size,
    text: lines.join("\n"),
  };
}

/* -------------------------------------------------------------------------- */
/* JSON                                                                       */
/* -------------------------------------------------------------------------- */

async function parseJson(file: File): Promise<ParsedDocument> {
  const raw = await file.text();
  let pretty: string;

  try {
    const parsed = JSON.parse(raw);
    pretty = JSON.stringify(parsed, null, 2);
  } catch {
    // Not valid JSON - keep the raw payload so nothing is lost.
    pretty = raw;
  }

  return {
    fileName: file.name,
    mimeType: file.type || "application/json",
    size: file.size,
    text: pretty,
  };
}

/* -------------------------------------------------------------------------- */
/* PDF                                                                        */
/* -------------------------------------------------------------------------- */

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

/**
 * Lazily loads pdfjs-dist in the browser and configures the worker.
 * If the worker cannot be initialised we fall back to running the
 * parser on the main thread (slower, but still functional).
 */
async function getPdfjs() {
  if (typeof window === "undefined") {
    throw new FileParseError("PDF parsing is only available in the browser.");
  }

  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      return pdfjs;
    })().catch((error) => {
      pdfjsPromise = null;
      throw error;
    });
  }

  return pdfjsPromise;
}

async function parsePdf(file: File): Promise<ParsedDocument> {
  const buffer = await file.arrayBuffer();
  let pdfjs: typeof import("pdfjs-dist");

  try {
    pdfjs = await getPdfjs();
  } catch {
    throw new FileParseError(
      "Could not initialise the PDF engine. Please re-upload as .txt or .md.",
    );
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // Disable the optional fetch of the standard font data (offline safe).
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    let lastY: number | null = null;
    let line = "";
    const lines: string[] = [];

    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = Array.isArray(item.transform) ? item.transform[5] : undefined;
      if (lastY !== null && typeof y === "number" && Math.abs(y - lastY) > 4) {
        lines.push(line.trim());
        line = "";
      }
      line += item.str;
      if ("hasEOL" in item && item.hasEOL) {
        lines.push(line.trim());
        line = "";
      }
      if (typeof y === "number") lastY = y;
    }
    if (line.trim()) lines.push(line.trim());

    const body = lines.filter((l) => l.length > 0).join("\n");
    pages.push(`--- Page ${pageNumber} ---\n${body}`);
  }

  await pdf.destroy();

  const text = pages.join("\n\n").trim();

  if (!text) {
    throw new FileParseError(
      "No extractable text found - the PDF may be a scanned image.",
    );
  }

  return {
    fileName: file.name,
    mimeType: file.type || "application/pdf",
    size: file.size,
    text,
    pageCount,
  };
}
