/** @jsxImportSource react */
import type { RoleplayCharacterRecord } from "@openwork/types/roleplay";
import { Download } from "lucide-react";
import * as React from "react";

import { cardExportFilename, exportCardJson, exportCardPng } from "@/app/roleplay/import-export";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";

type CharacterExportProps = { character: RoleplayCharacterRecord };

function download(filename: string, data: Uint8Array | string, type: string): void {
  if (typeof document === "undefined") return;
  // Copied into a fresh buffer so the Blob part is a plain ArrayBuffer view.
  const part: BlobPart = typeof data === "string" ? data : new Uint8Array(data);
  const url = URL.createObjectURL(new Blob([part], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Export the character on screen.
 *
 * PNG export asks for the picture to embed into rather than using an avatar,
 * because the app has none: nothing writes `avatarPath` yet. That also matches
 * how these files are made everywhere else — the card rides on the character's
 * art, and the user is the one who has it.
 */
export function CharacterExport({ character }: CharacterExportProps) {
  const imageRef = React.useRef<HTMLInputElement>(null);
  const name = character.card.data.name.trim();

  const embed = async (file: File | null | undefined) => {
    if (!file) return;
    const result = exportCardPng(character, new Uint8Array(await file.arrayBuffer()));
    if (!result.ok) {
      toast.error("Could not write the card into that image", { description: result.message });
      return;
    }
    download(cardExportFilename(name, "png"), result.bytes, "image/png");
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!name}
        onClick={() => download(cardExportFilename(name, "json"), exportCardJson(character), "application/json")}
      >
        <Download className="size-4" />
        Export JSON
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={!name} onClick={() => imageRef.current?.click()}>
        <Download className="size-4" />
        Export PNG…
      </Button>
      <input
        ref={imageRef}
        type="file"
        accept=".png,image/png"
        className="hidden"
        onChange={(event) => {
          void embed(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
