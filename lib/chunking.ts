import { CHUNK_OVERLAP, MAX_CHUNK_SIZE } from "./constants";

export interface RawChunk {
  index: number;
  content: string;
  start: number;
  end: number;
}

interface Block {
  text: string;
  start: number;
  end: number;
}

/**
 * Splits a piece of text into overlapping chunks.
 *
 * The splitter is structure aware:
 *  1. paragraphs are located, keeping their exact offsets;
 *  2. a short heading is glued to the paragraph that follows it so a section
 *     never gets separated from its body;
 *  3. blocks are packed up to `maxSize` characters;
 *  4. each chunk after the first starts with a `overlap` character tail of
 *     the previous chunk, snapped to a word boundary, so context that spans a
 *     cut is still retrievable.
 */
export function chunkText(
  text: string,
  options: { maxSize?: number; overlap?: number } = {},
): RawChunk[] {
  const maxSize = options.maxSize ?? MAX_CHUNK_SIZE;
  const overlap = options.overlap ?? CHUNK_OVERLAP;

  const normalised = text.replace(/\r\n?/g, "\n").trim();
  if (!normalised) return [];

  if (normalised.length <= maxSize) {
    return [
      {
        index: 0,
        content: normalised,
        start: 0,
        end: normalised.length,
      },
    ];
  }

  const blocks = splitBlocks(normalised);
  if (blocks.length === 0) return [];

  const chunks: RawChunk[] = [];
  let blockIndex = 0;
  let prefix = "";
  let prefixStart = 0;

  while (blockIndex < blocks.length) {
    const block = blocks[blockIndex];

    // A single block larger than the window: flush and hard-split it.
    if (block.text.length > maxSize) {
      if (prefix) {
        chunks.push({
          index: chunks.length,
          content: prefix,
          start: prefixStart,
          end: prefixStart + prefix.length,
        });
        prefix = "";
      }
      const slices = hardSplit(block.text, maxSize, overlap);
      slices.forEach((slice, sliceIndex) => {
        chunks.push({
          index: chunks.length,
          content: slice,
          start: block.start,
          end: block.start + slice.length,
        });
        if (sliceIndex === slices.length - 1) {
          // nothing further to seed
        }
      });
      blockIndex += 1;
      continue;
    }

    let content = prefix;
    let length = prefix.length;
    let start = prefix ? prefixStart : block.start;
    let end = start;
    let cursor = blockIndex;
    let first = prefix.length === 0;

    while (cursor < blocks.length) {
      const candidate = blocks[cursor];
      if (candidate.text.length > maxSize) break;

      const addition = first ? candidate.text.length : candidate.text.length + 2;
      if (length + addition > maxSize && !first) break;

      content += first ? candidate.text : `\n\n${candidate.text}`;
      length += addition;
      end = candidate.end;
      first = false;
      cursor += 1;

      if (length >= maxSize) break;
    }

    chunks.push({ index: chunks.length, content, start, end });

    if (cursor >= blocks.length) break;

    // Seed the next chunk with the tail of this one.
    const tail = tailOf(content, overlap);
    prefix = tail;
    prefixStart = Math.max(0, end - tail.length);
    blockIndex = cursor;
  }

  return chunks;
}

/**
 * Splits text into paragraph blocks and merges headings with the body that
 * follows them.
 */
function splitBlocks(text: string): Block[] {
  const paragraphs: Block[] = [];
  const separator = /\n{2,}/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  const push = (raw: string, base: number) => {
    if (!raw.trim()) return;
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    paragraphs.push({
      text: raw.trim(),
      start: base + leading,
      end: base + raw.length - trailing,
    });
  };

  while ((match = separator.exec(text)) !== null) {
    push(text.slice(cursor, match.index), cursor);
    cursor = match.index + match[0].length;
  }
  push(text.slice(cursor), cursor);

  // Glue a heading to the paragraph that follows it.
  const blocks: Block[] = [];
  for (let i = 0; i < paragraphs.length; i += 1) {
    const current = paragraphs[i];
    const next = paragraphs[i + 1];
    if (next && isHeading(current.text)) {
      blocks.push({
        text: `${current.text}\n\n${next.text}`,
        start: current.start,
        end: next.end,
      });
      i += 1;
      continue;
    }
    blocks.push(current);
  }

  return blocks;
}

/** Heuristic heading detection: short, single line, no terminal punctuation. */
function isHeading(text: string): boolean {
  if (text.includes("\n")) return false;
  if (text.length > 90) return false;
  if (/[.!?,;:]$/.test(text.trim())) return false;
  return true;
}

/**
 * Returns the last `size` characters of `text`, snapped forward to a word
 * boundary so the overlap never starts mid-word.
 */
export function tailOf(text: string, size: number): string {
  if (size <= 0 || text.length === 0) return "";
  if (text.length <= size) return text;
  const window = text.slice(text.length - size);
  const boundary = window.search(/\s/);
  if (boundary > 0 && boundary < window.length - 1) {
    return window.slice(boundary + 1);
  }
  return window;
}

/** Sliding-window split used for blocks that exceed the chunk size. */function hardSplit(text: string, maxSize: number, overlap: number): string[] {
  const out: string[] = [];
  const step = Math.max(1, maxSize - overlap);
  let pos = 0;

  while (pos < text.length) {
    let end = Math.min(text.length, pos + maxSize);
    if (end < text.length) {
      const window = text.slice(pos, end);
      const breakAt = Math.max(
        window.lastIndexOf("\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf(" "),
      );
      if (breakAt > maxSize * 0.5) end = pos + breakAt + 1;
    }
    const slice = text.slice(pos, end).trim();
    if (slice) out.push(slice);
    if (end >= text.length) break;
    pos = Math.max(pos + 1, end - overlap);
    if (pos <= 0) pos = step;
  }

  return out;
}
