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
      for (const slice of slices) {
        chunks.push({
          index: chunks.length,
          content: slice.text,
          start: block.start + slice.start,
          end: block.start + slice.end,
        });
      }
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
      // Only stop packing once at least one block has been taken. With a
      // seeded overlap tail the very first candidate can already blow the
      // window (150 + 717 > 800); breaking there left `cursor` sitting on
      // `blockIndex`, so the outer loop repacked the same block forever and
      // pushed a chunk on every pass until the tab ran out of memory.
      if (length + addition > maxSize && cursor > blockIndex) break;

      content += first ? candidate.text : `\n\n${candidate.text}`;
      length += addition;
      end = candidate.end;
      first = false;
      cursor += 1;

      if (length >= maxSize) break;
    }

    // Defence in depth: the inner loop always consumes at least one block,
    // so `cursor` should have moved. If a future change ever breaks that
    // contract, recover instead of repacking this block on every pass (an
    // endless repack pushes a chunk per turn until the tab runs out of memory).
    if (cursor === blockIndex) {
      if (prefix) {
        // The block did not fit behind the overlap tail and nothing was
        // taken: drop the tail and pack the block from a clean window.
        // The tail is a copy of the previous chunk's end, so dropping it
        // loses no content, and the next pass has `prefix === ""`.
        prefix = "";
        prefixStart = 0;
        continue;
      }
      // Unreachable in practice: with an empty window the first candidate is
      // this very block and always fits. Emit it alone so both progress and
      // content survive whatever change made this branch reachable.
      chunks.push({
        index: chunks.length,
        content: block.text,
        start: block.start,
        end: block.end,
      });
      blockIndex += 1;
      continue;
    }

    chunks.push({ index: chunks.length, content, start, end });

    if (cursor >= blocks.length) break;

    // Seed the next chunk with the tail of this one, trimmed to what still
    // fits in front of the block that follows. A full overlap tail ahead of
    // a long paragraph (150 + 717 > 800) pushed the packer's first candidate
    // over the window, so it took nothing, `cursor` never moved and the
    // outer loop repacked the same block forever until the tab ran out of
    // memory ("Aw, Snap!" on the EA39 upload). A non-positive `room` means
    // the next block fills the window by itself (or is heading for
    // `hardSplit`), so nothing is seeded there.
    const room = maxSize - (blocks[cursor].text.length + 2);
    const seedSize = Math.min(overlap, room);
    prefix = seedSize >= 1 ? tailOf(content, seedSize) : "";
    prefixStart = Math.max(0, end - prefix.length);
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

/**
 * Sliding-window split used for blocks that exceed the chunk size.
 *
 * Each slice carries its own offsets inside `text` (not the block's start),
 * otherwise every slice reports the same `end` and the persisted
 * start/end offsets drift away from the real position in the document.
 */
function hardSplit(
  text: string,
  maxSize: number,
  overlap: number,
): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = [];
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
    const raw = text.slice(pos, end);
    const slice = raw.trim();
    if (slice) {
      const lead = raw.length - raw.trimStart().length;
      out.push({
        text: slice,
        start: pos + lead,
        end: pos + lead + slice.length,
      });
    }
    if (end >= text.length) break;
    pos = Math.max(pos + 1, end - overlap);
    if (pos <= 0) pos = step;
  }

  return out;
}
