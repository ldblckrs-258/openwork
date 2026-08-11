import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  CARD_KEYWORD_V2,
  CARD_KEYWORD_V3,
  decodeCardFromPng,
  encodeCardToPng,
  readPngChunks,
} from "../../../apps/app/src/app/roleplay/png-codec.ts";
import {
  cardPng,
  compressedCardPng,
  corruptCrcPng,
  dualChunkPng,
  notAPng,
  overlongChunkPng,
  readCardChunk,
  SAMPLE_CARD_V2,
  SAMPLE_CARD_V3,
  strippedPng,
  truncatedPng,
  wrappedBase64Png,
} from "../../fixtures/roleplay/png-fixtures.ts";

describe("reading chunks", () => {
  test("a fixture built from RFC 2083 is read back chunk for chunk", () => {
    // The fixtures are written by an independent implementation. Agreement here
    // is the cross-check that a round trip through our own encoder cannot give.
    const read = readPngChunks(cardPng(SAMPLE_CARD_V2));

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "tEXt", "IEND"]);
  });

  test("a chunk that claims more bytes than the file holds is refused", () => {
    // Nothing may be allocated on the strength of a self-declared size. This is
    // the whole attack surface of a parser fed anonymous downloads.
    const read = readPngChunks(overlongChunkPng());

    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason.kind).toBe("malformed");
  });

  test("a truncated file fails instead of returning what it managed to read", () => {
    const read = readPngChunks(truncatedPng());

    expect(read.ok).toBe(false);
  });

  test("a corrupted chunk is rejected rather than decoded", () => {
    // A card decoded out of corrupt bytes is worse than a refusal: it imports as
    // a character whose text is quietly wrong.
    const read = readPngChunks(corruptCrcPng());

    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toEqual({ kind: "malformed", detail: "tEXt chunk failed its checksum" });
  });

  test("a file that is not a PNG is refused at the signature", () => {
    const read = readPngChunks(notAPng());

    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason.kind).toBe("not_png");
  });
});

describe("decoding a card", () => {
  test("a V2 card is read out of its chara chunk", () => {
    const decoded = decodeCardFromPng(cardPng(SAMPLE_CARD_V2));

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.keyword).toBe(CARD_KEYWORD_V2);
    expect(decoded.payload).toEqual(SAMPLE_CARD_V2);
  });

  test("ccv3 wins when a card ships both chunks", () => {
    // SPEC_V3: an app detecting both SHOULD use ccv3. Dual-chunk files are the
    // norm, so picking the wrong one would silently drop the nickname on most
    // real cards rather than on rare ones.
    const decoded = decodeCardFromPng(dualChunkPng(SAMPLE_CARD_V2, SAMPLE_CARD_V3));

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.keyword).toBe(CARD_KEYWORD_V3);
    expect(decoded.payload).toEqual(SAMPLE_CARD_V3);
  });

  test("base64 wrapped at 64 columns still decodes", () => {
    // Illegal inside a tEXt value and common anyway, because CLI tools and naive
    // encoders wrap by default.
    const decoded = decodeCardFromPng(wrappedBase64Png());

    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.payload).toEqual(SAMPLE_CARD_V2);
  });

  test("a re-encoded image reports that it carries no card", () => {
    const decoded = decodeCardFromPng(strippedPng());

    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.reason.kind).toBe("no_card");
  });

  test("a card stored only in a compressed chunk names that as the reason", () => {
    // Distinct from "no card": the data is there and readable by other apps. A
    // generic parse error would send the user hunting for a corrupt file.
    const decoded = decodeCardFromPng(compressedCardPng());

    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.reason).toEqual({ kind: "compressed_card", chunkType: "zTXt", keyword: "chara" });
  });
});

describe("the absent decompression path", () => {
  test("the codec contains no inflate implementation and calls none", async () => {
    // The reason zTXt/iTXt are refused rather than bounded: a sub-kilobyte
    // compressed chunk can inflate to gigabytes, exhausting memory before any
    // size cap can see the result. Asserted against the source because the only
    // safe amount of decompression code here is none, and a future edit that
    // adds "just a bounded one" should fail this.
    const source = await readFile(
      fileURLToPath(new URL("../../../apps/app/src/app/roleplay/png-codec.ts", import.meta.url)),
      "utf8",
    );
    // Comments stripped: the file explains at length why there is no inflate
    // path, and matching that prose would make this pass or fail on wording.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code).toContain("readPngChunks");
    for (const forbidden of ["DecompressionStream", "inflate", "unzip", "pako", "zlib", "gunzip"]) {
      expect(code).not.toContain(forbidden);
    }
  });
});

describe("encoding a card", () => {
  test("both chunks are written, so one file works in V2-only and V3-aware apps", () => {
    // What SillyTavern does. A single-chunk export would make the user choose a
    // format they have no way to reason about.
    const encoded = encodeCardToPng(strippedPng(), SAMPLE_CARD_V2, SAMPLE_CARD_V3);

    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(readCardChunk(encoded.bytes, CARD_KEYWORD_V2)).toEqual(SAMPLE_CARD_V2);
    expect(readCardChunk(encoded.bytes, CARD_KEYWORD_V3)).toEqual(SAMPLE_CARD_V3);
  });

  test("the payload is base64 of the UTF-8 JSON, read back by an independent decoder", () => {
    // The interoperability contract, checked without our own decoder in the loop.
    // A checked-in file produced by SillyTavern itself would be stronger evidence;
    // this is the automatable half of it.
    const encoded = encodeCardToPng(strippedPng(), SAMPLE_CARD_V2, SAMPLE_CARD_V3);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    expect(readCardChunk(encoded.bytes, CARD_KEYWORD_V2)).toEqual(SAMPLE_CARD_V2);
  });

  test("card chunks land before IEND and the image chunks keep their order", () => {
    // tEXt may legally sit anywhere after IHDR, but IDAT runs must stay adjacent
    // and some strict decoders enforce it.
    const encoded = encodeCardToPng(strippedPng(), SAMPLE_CARD_V2, SAMPLE_CARD_V3);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const read = readPngChunks(encoded.bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "tEXt", "tEXt", "IEND"]);
  });

  test("re-exporting replaces the old card instead of stacking a second one", () => {
    // Two chara chunks is not a merge, it is an ambiguity: which one a reader
    // picks is undefined, so an edited card could import as its previous version.
    const once = encodeCardToPng(cardPng(SAMPLE_CARD_V2), SAMPLE_CARD_V2, SAMPLE_CARD_V3);
    expect(once.ok).toBe(true);
    if (!once.ok) return;

    const read = readPngChunks(once.bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.chunks.filter((chunk) => chunk.type === "tEXt")).toHaveLength(2);
  });

  test("a round trip through both halves of the codec preserves the card", () => {
    const encoded = encodeCardToPng(strippedPng(), SAMPLE_CARD_V2, SAMPLE_CARD_V3);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const decoded = decodeCardFromPng(encoded.bytes);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.payload).toEqual(SAMPLE_CARD_V3);
  });

  test("an image the codec cannot read is refused rather than written blind", () => {
    const encoded = encodeCardToPng(notAPng(), SAMPLE_CARD_V2, SAMPLE_CARD_V3);

    expect(encoded.ok).toBe(false);
  });
});
