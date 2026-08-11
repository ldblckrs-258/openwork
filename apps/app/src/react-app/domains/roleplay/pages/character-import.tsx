/** @jsxImportSource react */
import type { RoleplayCharacterRecord } from "@openwork/types/roleplay";
import { Upload } from "lucide-react";
import * as React from "react";

import { createCharacterId } from "@/app/roleplay/character-draft";
import { importCardFromFile, importedCharacterRecord } from "@/app/roleplay/import-export";
import { Button } from "@/components/ui/button";

type CharacterImportProps = {
  onImported: (character: RoleplayCharacterRecord, losses: string[]) => void;
  onCancel: () => void;
};

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Import a character card.
 *
 * Reads the file in the renderer and hands the result to the editor unsaved, so
 * a stranger's card is on screen and editable before anything is written. The
 * decode and the sanitize both happen in `importCardFromFile`; this component
 * only moves bytes and shows what came back.
 */
export function CharacterImport({ onImported, onCancel }: CharacterImportProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const accept = async (file: File | null | undefined) => {
    if (!file) return;
    setError(null);
    const result = importCardFromFile(new Uint8Array(await file.arrayBuffer()));
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onImported(
      importedCharacterRecord(
        result.card,
        result.report.charSubstitutionName,
        createCharacterId(Date.now(), randomSuffix()),
        Date.now(),
      ),
      result.losses,
    );
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-10 py-6">
      <div>
        <h3 className="text-sm font-medium">Import a character</h3>
        <p className="text-muted-foreground text-sm">
          A card as JSON, or a PNG with the card embedded — the format SillyTavern, Chub, and RisuAI trade in.
        </p>
      </div>

      <button
        type="button"
        className={`border-border flex flex-col items-center gap-2 rounded-md border border-dashed p-10 text-sm ${
          dragging ? "border-primary bg-accent" : ""
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void accept(event.dataTransfer.files[0]);
        }}
      >
        <Upload className="size-5" />
        <span>Drop a card here, or choose a file</span>
        <span className="text-muted-foreground">.json or .png</span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".json,.png,application/json,image/png"
        className="hidden"
        onChange={(event) => {
          void accept(event.target.files?.[0]);
          // Cleared so picking the same file twice after an error fires again.
          event.target.value = "";
        }}
      />

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="flex items-center justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
