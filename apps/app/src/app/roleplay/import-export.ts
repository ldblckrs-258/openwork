import type {
  CharacterCardV2,
  RoleplayCharacterRecord,
  SceneRecord,
} from "@openwork/types/roleplay";
import {
  initialSceneState,
  normalizeHardLimits,
  openworkCardExtensionSchema,
} from "@openwork/types/roleplay";

import {
  decodeCardFromPng,
  encodeCardToPng,
  type PngFailure,
} from "./png-codec.js";
import {
  sanitizeCard,
  type CardRejectReason,
  type CardSanitizeReport,
} from "./sanitize-card.js";

export type CardImportFormat = "json" | "png";

export type CardImportSuccess = {
  ok: true;
  card: CharacterCardV2;
  report: CardSanitizeReport;
  format: CardImportFormat;
  losses: string[];
};

export type CardImportFailure = { ok: false; message: string };

export type CardImportResult = CardImportSuccess | CardImportFailure;

function describePngFailure(reason: PngFailure): string {
  if (reason.kind === "not_png") return "That file is not a PNG.";
  if (reason.kind === "malformed")
    return `This PNG is damaged: ${reason.detail}.`;
  if (reason.kind === "bad_payload")
    return `This PNG carries a character card, but ${reason.detail}.`;
  if (reason.kind === "compressed_card") {
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
  if (reason.kind === "not_json_object")
    return "That file does not contain a character card object.";
  if (reason.kind === "too_large") {
    return `That card is ${Math.round(reason.bytes / 1_000_000)}MB, over the ${Math.round(reason.limit / 1_000_000)}MB limit.`;
  }
  return "That file is not a character card OpenWork recognises.";
}

export function describeLosses(report: CardSanitizeReport): string[] {
  const losses: string[] = [];
  if (report.droppedV3Fields.length > 0) {
    losses.push(
      `V3 fields this app cannot use were dropped: ${report.droppedV3Fields.join(", ")}.`,
    );
  }
  if (report.strippedKeys.length > 0) {
    losses.push(`Removed for safety: ${report.strippedKeys.join(", ")}.`);
  }
  if (report.truncatedFields.length > 0) {
    losses.push(
      `Shortened to fit the size limits: ${report.truncatedFields.join(", ")}.`,
    );
  }
  return losses;
}

function gate(payload: unknown, format: CardImportFormat): CardImportResult {
  const sanitized = sanitizeCard(payload);
  if (!sanitized.ok)
    return { ok: false, message: describeRejection(sanitized.reason) };
  return {
    ok: true,
    card: sanitized.card,
    report: sanitized.report,
    format,
    losses: describeLosses(sanitized.report),
  };
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
  if (!decoded.ok)
    return { ok: false, message: describePngFailure(decoded.reason) };
  return gate(decoded.payload, "png");
}

export function importCardFromFile(bytes: Uint8Array): CardImportResult {
  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  if (isPng) return importCardFromPng(bytes);

  const text = new TextDecoder().decode(bytes);
  const result = importCardFromJson(text);

  if (!result.ok && !/^\s*[[{]/.test(text)) {
    return {
      ok: false,
      message:
        "OpenWork reads character cards as .json files, or as .png images with the card embedded. This file is neither.",
    };
  }
  return result;
}

function importedOpenworkFields(
  card: CharacterCardV2,
  now: number,
): {
  nsfw: boolean;
  sceneRecords: SceneRecord[];
  hardLimits: string[];
} {
  const parsed = openworkCardExtensionSchema.safeParse(
    card.data.extensions.openwork,
  );
  if (!parsed.success) return { nsfw: false, sceneRecords: [], hardLimits: [] };
  return {
    nsfw: parsed.data.nsfw,
    sceneRecords: initialSceneState(parsed.data.sceneRecords, now).records,
    hardLimits: normalizeHardLimits(parsed.data.hardLimits),
  };
}

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
    attachedSkills: [],
    ...importedOpenworkFields(card, now),
    createdAt: now,
    updatedAt: now,
  };
}

export function cardWithOpenworkExtension(
  record: RoleplayCharacterRecord,
): CharacterCardV2 {
  const { openwork: _replaced, ...otherVendors } = record.card.data.extensions;
  const hasSomethingToSay =
    record.nsfw ||
    record.sceneRecords.length > 0 ||
    record.hardLimits.length > 0;

  return {
    ...record.card,
    data: {
      ...record.card.data,
      extensions: {
        ...otherVendors,
        ...(hasSomethingToSay
          ? {
              openwork: {
                version: 1,
                nsfw: record.nsfw,
                hardLimits: record.hardLimits,
                sceneRecords: record.sceneRecords,
              },
            }
          : {}),
      },
    },
  };
}

export function toCardV3(record: RoleplayCharacterRecord): unknown {
  const nickname = record.charSubstitutionName.trim();
  return {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      ...cardWithOpenworkExtension(record).data,
      ...(nickname && nickname !== record.card.data.name ? { nickname } : {}),
    },
  };
}

export function exportCardJson(record: RoleplayCharacterRecord): string {
  return `${JSON.stringify(cardWithOpenworkExtension(record), null, 2)}\n`;
}

export type CardExportPngResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; message: string };

export function exportCardPng(
  record: RoleplayCharacterRecord,
  imageBytes: Uint8Array,
): CardExportPngResult {
  const encoded = encodeCardToPng(
    imageBytes,
    cardWithOpenworkExtension(record),
    toCardV3(record),
  );
  if (!encoded.ok)
    return { ok: false, message: describePngFailure(encoded.reason) };
  return { ok: true, bytes: encoded.bytes };
}

export function cardExportFilename(
  name: string,
  extension: "json" | "png",
): string {
  const slug = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "character"}.${extension}`;
}
