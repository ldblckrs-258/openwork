/**
 * Reading and writing character cards embedded in PNG `tEXt` chunks.
 *
 * This is the format the community actually trades in: a picture of the
 * character with the card's JSON base64'd into an ancillary chunk. Implemented
 * from RFC 2083 §11.3.3.3 and `reports/card-spec-research.md` §4 rather than
 * pulled in as a dependency — the whole codec is a few hundred lines and the
 * three npm packages SillyTavern uses would each need auditing anyway.
 *
 * Every byte read here comes from a file a stranger made. Two rules follow:
 *
 *   1. Nothing is allocated on the strength of a self-declared size. A chunk
 *      that claims to be longer than the bytes remaining is malformed, and is
 *      rejected before the slice is taken.
 *   2. **There is no decompression path, deliberately.** `zTXt`/`iTXt` carry
 *      zlib-compressed payloads, and a sub-kilobyte chunk can inflate to
 *      gigabytes — a local denial of service from opening a downloaded picture.
 *      A card that lives only in a compressed chunk is reported as exactly that,
 *      rather than bounded, streamed, or guessed at. `tEXt` is what SillyTavern
 *      writes, so the common case is covered.
 */

export const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Long enough for a large lorebook, short enough that a bogus length cannot exhaust memory. */
export const MAX_CHUNK_BYTES = 8_000_000;
/** A real PNG has tens of chunks. A file with thousands is a decompression bomb's shape. */
export const MAX_CHUNKS = 4_096;

export const CARD_KEYWORD_V2 = "chara";
export const CARD_KEYWORD_V3 = "ccv3";

export type PngChunk = { type: string; data: Uint8Array };

export type PngFailure =
  | { kind: "not_png" }
  | { kind: "malformed"; detail: string }
  | { kind: "no_card" }
  | { kind: "compressed_card"; chunkType: string; keyword: string }
  | { kind: "bad_payload"; detail: string };

export type PngChunksResult = { ok: true; chunks: PngChunk[] } | { ok: false; reason: PngFailure };

export type PngCardResult =
  | { ok: true; payload: unknown; keyword: typeof CARD_KEYWORD_V2 | typeof CARD_KEYWORD_V3 }
  | { ok: false; reason: PngFailure };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function hasSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] as number) << 24) |
    ((bytes[offset + 1] as number) << 16) |
    ((bytes[offset + 2] as number) << 8) |
    (bytes[offset + 3] as number)
  ) >>> 0;
}

function writeUint32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function ascii(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff;
  return out;
}

/**
 * Walk the chunk stream.
 *
 * The CRC is verified rather than ignored. A mismatch means the file was
 * corrupted in transit, and a card decoded out of corrupted bytes is worse than
 * a refusal: it imports as a character with quietly wrong text.
 */
export function readPngChunks(bytes: Uint8Array): PngChunksResult {
  if (!hasSignature(bytes)) return { ok: false, reason: { kind: "not_png" } };

  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.length;

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return { ok: false, reason: { kind: "malformed", detail: "truncated chunk header" } };
    const length = readUint32(bytes, offset);
    if (length > MAX_CHUNK_BYTES) {
      return { ok: false, reason: { kind: "malformed", detail: `chunk declares ${length} bytes` } };
    }
    const dataStart = offset + 8;
    const crcStart = dataStart + length;
    if (crcStart + 4 > bytes.length) {
      return { ok: false, reason: { kind: "malformed", detail: "chunk runs past the end of the file" } };
    }

    const type = ascii(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(dataStart, crcStart);
    if (crc32(bytes.subarray(offset + 4, crcStart)) !== readUint32(bytes, crcStart)) {
      return { ok: false, reason: { kind: "malformed", detail: `${type} chunk failed its checksum` } };
    }

    chunks.push({ type, data });
    if (chunks.length > MAX_CHUNKS) {
      return { ok: false, reason: { kind: "malformed", detail: "too many chunks" } };
    }

    offset = crcStart + 4;
    if (type === "IEND") break;
  }

  if (chunks.length === 0) return { ok: false, reason: { kind: "malformed", detail: "no chunks" } };
  return { ok: true, chunks };
}

function splitKeyword(data: Uint8Array): { keyword: string; rest: Uint8Array } | undefined {
  const separator = data.indexOf(0);
  if (separator <= 0) return undefined;
  return { keyword: ascii(data.subarray(0, separator)), rest: data.subarray(separator + 1) };
}

function isCardKeyword(keyword: string): keyword is typeof CARD_KEYWORD_V2 | typeof CARD_KEYWORD_V3 {
  const lower = keyword.toLowerCase();
  return lower === CARD_KEYWORD_V2 || lower === CARD_KEYWORD_V3;
}

function decodeBase64Json(text: string): { ok: true; value: unknown } | { ok: false; detail: string } {
  const compact = text.replace(/\s+/g, "");
  let binary: string;
  try {
    binary = atob(compact);
  } catch {
    return { ok: false, detail: "the embedded payload is not valid base64" };
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, detail: "the embedded payload is not valid JSON" };
  }
}

/**
 * Pull the card payload out of a PNG.
 *
 * `ccv3` wins over `chara` when both are present, per SPEC_V3. What comes back is
 * the raw decoded JSON — sanitizing it is the importer's job, not the codec's, so
 * there is exactly one place that decides what this app will hold.
 */
export function decodeCardFromPng(bytes: Uint8Array): PngCardResult {
  const read = readPngChunks(bytes);
  if (!read.ok) return { ok: false, reason: read.reason };

  const text = new Map<string, string>();
  let compressed: { chunkType: string; keyword: string } | undefined;

  for (const chunk of read.chunks) {
    const split = splitKeyword(chunk.data);
    if (!split || !isCardKeyword(split.keyword)) continue;

    if (chunk.type === "tEXt") {
      text.set(split.keyword.toLowerCase(), ascii(split.rest));
      continue;
    }
    if (chunk.type === "zTXt" || chunk.type === "iTXt") {
      compressed ??= { chunkType: chunk.type, keyword: split.keyword.toLowerCase() };
    }
  }

  const keyword = text.has(CARD_KEYWORD_V3) ? CARD_KEYWORD_V3 : text.has(CARD_KEYWORD_V2) ? CARD_KEYWORD_V2 : undefined;
  if (!keyword) {
    if (compressed) return { ok: false, reason: { kind: "compressed_card", ...compressed } };
    return { ok: false, reason: { kind: "no_card" } };
  }

  const decoded = decodeBase64Json(text.get(keyword) as string);
  if (!decoded.ok) return { ok: false, reason: { kind: "bad_payload", detail: decoded.detail } };
  return { ok: true, payload: decoded.value, keyword };
}

function textChunk(keyword: string, value: string): PngChunk {
  const keywordBytes = asciiBytes(keyword);
  const valueBytes = asciiBytes(value);
  const data = new Uint8Array(keywordBytes.length + 1 + valueBytes.length);
  data.set(keywordBytes, 0);
  data[keywordBytes.length] = 0;
  data.set(valueBytes, keywordBytes.length + 1);
  return { type: "tEXt", data };
}

function encodeBase64Json(value: unknown): string {
  const json = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of json) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function writePngChunks(chunks: PngChunk[]): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array(PNG_SIGNATURE)];
  for (const chunk of chunks) {
    const typeBytes = asciiBytes(chunk.type);
    const body = new Uint8Array(typeBytes.length + chunk.data.length);
    body.set(typeBytes, 0);
    body.set(chunk.data, typeBytes.length);
    parts.push(writeUint32(chunk.data.length), body, writeUint32(crc32(body)));
  }

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export type PngEncodeResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: PngFailure };

export function encodeCardToPng(imageBytes: Uint8Array, cardV2: unknown, cardV3: unknown): PngEncodeResult {
  const read = readPngChunks(imageBytes);
  if (!read.ok) return { ok: false, reason: read.reason };

  const kept = read.chunks.filter((chunk) => {
    if (chunk.type !== "tEXt" && chunk.type !== "zTXt" && chunk.type !== "iTXt") return true;
    const split = splitKeyword(chunk.data);
    return !split || !isCardKeyword(split.keyword);
  });

  const end = kept.findIndex((chunk) => chunk.type === "IEND");
  if (end === -1) return { ok: false, reason: { kind: "malformed", detail: "the image has no IEND chunk" } };

  const cardChunks = [
    textChunk(CARD_KEYWORD_V2, encodeBase64Json(cardV2)),
    textChunk(CARD_KEYWORD_V3, encodeBase64Json(cardV3)),
  ];

  return { ok: true, bytes: writePngChunks([...kept.slice(0, end), ...cardChunks, ...kept.slice(end)]) };
}
