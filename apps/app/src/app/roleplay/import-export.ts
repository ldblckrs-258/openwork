import type { CharacterCardV2, RoleplayCharacterRecord } from "@openwork/types/roleplay";

import { decodeCardFromPng, encodeCardToPng, type PngFailure } from "./png-codec.js";
import { sanitizeCard, type CardSanitizeReport, type CardRejectReason } from "./sanitize-card.js";

/**
 * The import gate and the export writer.
 *
 * Every way a card can enter the app — JSON text, PNG bytes, the file picker,
 * a drop — arrives here and leaves through `sanitizeCard`. There is no fast path
 * and no second entry point, because the sanitizer is the control that makes an
 * anonymous download safe to open: it is what strips `tools`, `permission`, and
 * unknown extension vendors before any of the card's text reaches a prompt.
 *
 * Losses are reported, never silent. A V3 card genuinely loses fields here, and
 * a user who is told which ones can decide whether to keep the import; one who is
 * not will find out when the character misbehaves.
 */

export type CardImportFormat = "json" | "png";

export type CardImportSuccess = {
  ok: true;
  card: CharacterCardV2;
  report: CardSanitizeReport;
  format: CardImportFormat;
  /** Human-readable lines naming everything the import dropped or shortened. */
  losses: string[];
};

export type CardImportFailure = { ok: false; message: string };

export type CardImportResult = CardImportSuccess | CardImportFailure;

function describePngFailure(reason: PngFailure): string {
  if (reason.kind === "not_png") return "That file is not a PNG.";
  if (reason.kind === "malformed") return `This PNG is damaged: ${reason.detail}.`;
  if (reason.kind === "bad_payload") return `This PNG carries a character card, but ${reason.detail}.`;
  if (reason.kind === "compressed_card") {
    // Named specifically. The alternative — a generic parse error — sends the user
    // looking for a corrupt file when the card is intact and simply stored a way
    // this app will not read.
    return (
      `This PNG stores its character in a compressed ${reason.chunkType} chunk, which OpenWork does not read. ` +
      "Ask for the card as JSON, or re-export it from an app that writes uncompressed tEXt chunks."
    );
  }
  return (
    "This PNG has no character card in it. Image hosts and chat apps strip the data when they re-encode a picture, " +
    "so a re-uploaded card often arrives as an ordinary image."
  );
}

function describeRejection(reason: CardRejectReason): string {
  if (reason.kind === "not_json_object") return "That file does not contain a character card object.";
  if (reason.kind === "too_large") {
    return `That card is ${Math.round(reason.bytes / 1_000_000)}MB, over the ${Math.round(reason.limit / 1_000_000)}MB limit.`;
  }
  return "That file is not a character card OpenWork recognises.";
}

/**
 * Turn a sanitize report into lines a person can act on.
 *
 * Ordered by how much the user is likely to care: dropped V3 features change how
 * the character behaves, stripped keys are a security event worth seeing, and
 * truncation is a size note.
 */
export function describeLosses(report: CardSanitizeReport): string[] {
  const losses: string[] = [];
  if (report.droppedV3Fields.length > 0) {
    losses.push(`V3 fields this app cannot use were dropped: ${report.droppedV3Fields.join(", ")}.`);
  }
  if (report.strippedKeys.length > 0) {
    losses.push(`Removed for safety: ${report.strippedKeys.join(", ")}.`);
  }
  if (report.truncatedFields.length > 0) {
    losses.push(`Shortened to fit the size limits: ${report.truncatedFields.join(", ")}.`);
  }
  return losses;
}

function gate(payload: unknown, format: CardImportFormat): CardImportResult {
  const sanitized = sanitizeCard(payload);
  if (!sanitized.ok) return { ok: false, message: describeRejection(sanitized.reason) };
  return { ok: true, card: sanitized.card, report: sanitized.report, format, losses: describeLosses(sanitized.report) };
}

export function importCardFromJson(text: string): CardImportResult {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, message: "That file is not valid JSON." };
  }
  return gate(payload, "json");
}

export function importCardFromPng(bytes: Uint8Array): CardImportResult {
  const decoded = decodeCardFromPng(bytes);
  if (!decoded.ok) return { ok: false, message: describePngFailure(decoded.reason) };
  return gate(decoded.payload, "png");
}

/**
 * Route a picked file to the right decoder.
 *
 * Dispatch is on the PNG signature first and the extension only as a fallback:
 * a card renamed to `.txt` still imports, and a `.png` that is really JSON does
 * not fail with a PNG error message.
 */
export function importCardFromFile(bytes: Uint8Array): CardImportResult {
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (isPng) return importCardFromPng(bytes);

  const text = new TextDecoder().decode(bytes);
  const result = importCardFromJson(text);
  // A GIF sent down the JSON path would otherwise be reported as invalid JSON,
  // which reads as a corrupt card rather than as the wrong kind of file.
  if (!result.ok && !/^\s*[[{]/.test(text)) {
    return {
      ok: false,
      message: "OpenWork reads character cards as .json files, or as .png images with the card embedded. This file is neither.",
    };
  }
  return result;
}

/**
 * Wrap an imported card as an unsaved character record.
 *
 * `imported`, unlike a generated one: the text is a stranger's until the user
 * edits it, and `charSubstitutionName` may carry a V3 nickname that a later name
 * edit must not overwrite — which is the distinction `applyCardEdit` keys off.
 */
export function importedCharacterRecord(
  card: CharacterCardV2,
  charSubstitutionName: string,
  id: string,
  now: number,
): RoleplayCharacterRecord {
  return {
    id,
    card,
    charSubstitutionName: charSubstitutionName || card.data.name,
    source: "imported",
    // Never inherited from the file. A card is a stranger's text; letting it
    // name a workspace skill would let it choose what guidance the character
    // writes under, which is a decision that belongs to the person importing it.
    attachedSkills: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The V3 form of a stored character, for the dual-write on export.
 *
 * Only `nickname` is genuinely V3 — it is the one V3 field this app keeps, and
 * writing it back is what stops a V3 card from losing its `{{char}}` override
 * after a round trip through here. Nothing else is invented: fields the app never
 * held are not fabricated to look like a richer card than it has.
 */
export function toCardV3(record: RoleplayCharacterRecord): unknown {
  const nickname = record.charSubstitutionName.trim();
  return {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      ...record.card.data,
      ...(nickname && nickname !== record.card.data.name ? { nickname } : {}),
    },
  };
}

export function exportCardJson(record: RoleplayCharacterRecord): string {
  return `${JSON.stringify(record.card, null, 2)}\n`;
}

export type CardExportPngResult = { ok: true; bytes: Uint8Array } | { ok: false; message: string };

/**
 * Write the card into a picture the user chose.
 *
 * The app has no avatar of its own to fall back on, so the base image is an
 * input rather than a default. That also matches how these files are made
 * everywhere else: the card rides on the character's art.
 */
export function exportCardPng(record: RoleplayCharacterRecord, imageBytes: Uint8Array): CardExportPngResult {
  const encoded = encodeCardToPng(imageBytes, record.card, toCardV3(record));
  if (!encoded.ok) return { ok: false, message: describePngFailure(encoded.reason) };
  return { ok: true, bytes: encoded.bytes };
}

export function cardExportFilename(name: string, extension: "json" | "png"): string {
  const slug = name.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug || "character"}.${extension}`;
}
