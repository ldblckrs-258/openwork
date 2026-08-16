/** @jsxImportSource react */
import type { RoleplayLorebookRecord } from "@openwork/types/roleplay";
import { Upload } from "lucide-react";
import * as React from "react";

import { createLorebookId } from "@/app/roleplay/lorebook";
import { importLorebookFromFile, importedLorebookRecord } from "@/app/roleplay/lorebook-import";
import { Button } from "@/components/ui/button";

type LorebookImportProps = {
  onImported: (lorebook: RoleplayLorebookRecord, losses: string[]) => void;
  onCancel: () => void;
};

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim() || "Imported lorebook";
}

export function LorebookImport({ onImported, onCancel }: LorebookImportProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const accept = async (file: File | null | undefined) => {
    if (!file) return;
    setError(null);
    const result = importLorebookFromFile(new Uint8Array(await file.arrayBuffer()));
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onImported(
      importedLorebookRecord(result.book, {
        id: createLorebookId(Date.now(), randomSuffix()),
        now: Date.now(),
        format: result.format,
        fallbackName: nameFromFile(file.name),
      }),
      result.losses,
    );
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-10 py-6">
      <div>
        <h3 className="text-sm font-medium">Import a lorebook</h3>
        <p className="text-muted-foreground text-sm">
          SillyTavern world info, a NovelAI <code>.lorebook</code>, an Agnai memory book, a RisuAI lorebook, or the
          lorebook inside a character card.
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
        <span>Drop a lorebook here, or choose a file</span>
        <span className="text-muted-foreground">.json, .lorebook, or a card .png</span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".json,.lorebook,.png,application/json,image/png"
        className="hidden"
        onChange={(event) => {
          void accept(event.target.files?.[0]);
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
