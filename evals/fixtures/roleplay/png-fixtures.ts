/**
 * PNG fixtures, built by a writer that is deliberately independent of the codec
 * under test.
 *
 * Nothing here calls `png-codec.ts`. If the fixtures were produced by the same
 * code the specs exercise, a decoder bug and a matching encoder bug would cancel
 * out and every round trip would still pass. These bytes are assembled straight
 * from RFC 2083 instead, so agreement between the two implementations is
 * evidence rather than tautology.
 *
 * They are built rather than checked in as binaries so the malformed cases —
 * a wrong checksum, a length that runs past the end, a wrapped base64 payload —
 * are readable in the diff instead of being opaque blobs.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table: number[] = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table.push(value >>> 0);
  }
  return table;
})();

function crc(bytes: number[]): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (CRC_TABLE[(value ^ byte) & 0xff] as number) ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function uint32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function bytesOf(text: string): number[] {
  return [...text].map((character) => character.charCodeAt(0) & 0xff);
}

export type RawChunk = { type: string; data: number[]; corruptCrc?: boolean; declaredLength?: number };

export function chunkBytes(chunk: RawChunk): number[] {
  const body = [...bytesOf(chunk.type), ...chunk.data];
  const checksum = crc(body);
  return [
    ...uint32(chunk.declaredLength ?? chunk.data.length),
    ...body,
    ...uint32(chunk.corruptCrc ? (checksum ^ 0xffff) >>> 0 : checksum),
  ];
}

export function pngOf(chunks: RawChunk[]): Uint8Array {
  return new Uint8Array([...SIGNATURE, ...chunks.flatMap(chunkBytes)]);
}

/** 1x1 greyscale header and a stub image payload. The codec never decodes pixels. */
export const IHDR: RawChunk = {
  type: "IHDR",
  data: [...uint32(1), ...uint32(1), 8, 0, 0, 0, 0],
};
export const IDAT: RawChunk = { type: "IDAT", data: [0x08, 0x1d, 0x01, 0x02, 0x00] };
export const IEND: RawChunk = { type: "IEND", data: [] };

function base64Of(text: string): string {
  const utf8 = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of utf8) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function textChunk(keyword: string, value: string): RawChunk {
  return { type: "tEXt", data: [...bytesOf(keyword), 0, ...bytesOf(value)] };
}

/** The payload format both card specs define: base64 of the UTF-8 JSON string. */
export function cardChunk(keyword: string, card: unknown, options: { wrapAt?: number } = {}): RawChunk {
  const encoded = base64Of(JSON.stringify(card));
  const value = options.wrapAt ? (encoded.match(new RegExp(`.{1,${options.wrapAt}}`, "g")) ?? []).join("\n") : encoded;
  return textChunk(keyword, value);
}

/** Decode a card payload without using the codec, for asserting what was written. */
export function readCardChunk(bytes: Uint8Array, keyword: string): unknown {
  let offset = SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length =
      ((bytes[offset] as number) << 24) |
      ((bytes[offset + 1] as number) << 16) |
      ((bytes[offset + 2] as number) << 8) |
      (bytes[offset + 3] as number);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "tEXt") {
      const separator = data.indexOf(0);
      const found = String.fromCharCode(...data.subarray(0, separator));
      if (found === keyword) {
        const value = String.fromCharCode(...data.subarray(separator + 1));
        const binary = atob(value.replace(/\s+/g, ""));
        const raw = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) raw[index] = binary.charCodeAt(index);
        return JSON.parse(new TextDecoder().decode(raw));
      }
    }
    offset += 12 + length;
  }
  return undefined;
}

export const SAMPLE_CARD_V2 = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Aria",
    description: "The night archivist.",
    personality: "guarded, dry",
    scenario: "A rain-soaked library, ten minutes past closing.",
    first_mes: '*She does not look up.* "You\'re late."',
    mes_example: "<START>\n{{user}}: Is the east wing open?\n{{char}}: \"It is not.\"",
    creator_notes: "Quiet scenes.",
    system_prompt: "",
    post_history_instructions: "",
    alternate_greetings: ["*The door is already locked.*"],
    tags: ["mystery"],
    creator: "spec",
    character_version: "1.0",
    extensions: {},
  },
};

export const SAMPLE_CARD_V3 = {
  spec: "chara_card_v3",
  spec_version: "3.0",
  data: {
    ...SAMPLE_CARD_V2.data,
    nickname: "The Archivist",
    source: ["https://example.invalid/aria"],
    group_only_greetings: ["*She ignores the room.*"],
    creation_date: 1_700_000_000,
    assets: [{ type: "icon", uri: "ccdefault:", name: "main", ext: "png" }],
  },
};

/** A card carrying the keys the sanitizer exists to strip. */
export const HOSTILE_CARD = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  tools: { "*": true },
  data: {
    ...SAMPLE_CARD_V2.data,
    permission: { "*": "allow" },
    extensions: { openwork: { keep: true }, sillytavern: { depth_prompt: "x" } },
  },
};

export function cardPng(card: unknown, keyword = "chara"): Uint8Array {
  return pngOf([IHDR, IDAT, cardChunk(keyword, card), IEND]);
}

export function dualChunkPng(v2: unknown, v3: unknown): Uint8Array {
  return pngOf([IHDR, IDAT, cardChunk("chara", v2), cardChunk("ccv3", v3), IEND]);
}

/** What an image host returns after re-encoding: a valid picture, no card. */
export function strippedPng(): Uint8Array {
  return pngOf([IHDR, IDAT, IEND]);
}

/** A card stored the one way this codec refuses to read. */
export function compressedCardPng(): Uint8Array {
  return pngOf([IHDR, IDAT, { type: "zTXt", data: [...bytesOf("chara"), 0, 0, 0x78, 0x9c, 0x01] }, IEND]);
}

export function corruptCrcPng(): Uint8Array {
  return pngOf([IHDR, { ...cardChunk("chara", SAMPLE_CARD_V2), corruptCrc: true }, IEND]);
}

/** A chunk header that claims more bytes than the file holds. */
export function overlongChunkPng(): Uint8Array {
  return pngOf([IHDR, { ...IDAT, declaredLength: 5_000 }, IEND]);
}

export function truncatedPng(): Uint8Array {
  const full = cardPng(SAMPLE_CARD_V2);
  return full.subarray(0, full.length - 20);
}

/** Base64 wrapped at 64 columns, the way `openssl base64` and naive encoders emit it. */
export function wrappedBase64Png(): Uint8Array {
  return pngOf([IHDR, IDAT, cardChunk("chara", SAMPLE_CARD_V2, { wrapAt: 64 }), IEND]);
}

export function notAPng(): Uint8Array {
  return new Uint8Array(bytesOf("GIF89a this is not a png"));
}
