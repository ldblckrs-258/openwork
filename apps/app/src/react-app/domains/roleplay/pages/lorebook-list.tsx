/** @jsxImportSource react */
import type { RoleplayCharacterRecord, RoleplayLorebookRecord } from "@openwork/types/roleplay";
import { BookOpen, Plus, Trash2, Upload } from "lucide-react";

import { LOREBOOK_FORMAT_LABELS, type LorebookImportFormat } from "@/app/roleplay/lorebook-import";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

type LorebookListProps = {
  lorebooks: RoleplayLorebookRecord[];
  characters: RoleplayCharacterRecord[];
  loading: boolean;
  onCreate: () => void;
  onImport: () => void;
  onOpen: (lorebook: RoleplayLorebookRecord) => void;
  onDelete: (lorebook: RoleplayLorebookRecord) => void;
};

function formatLabel(format: string | undefined): string | undefined {
  if (!format) return undefined;
  return LOREBOOK_FORMAT_LABELS[format as LorebookImportFormat];
}

/**
 * Who this book actually reaches.
 *
 * Names, not a count: "3 attached" still leaves the user opening the book to
 * find out whether it reaches the character they are about to play.
 */
function attachedNames(lorebook: RoleplayLorebookRecord, characters: RoleplayCharacterRecord[]): string[] {
  return lorebook.characterIds
    .map((id) => characters.find((character) => character.id === id))
    .filter((character): character is RoleplayCharacterRecord => character !== undefined)
    .map((character) => character.card.data.name || "Untitled character");
}

/**
 * The world library.
 *
 * Each row says the two things that decide whether a book is doing anything: how
 * many entries it holds, and how many characters it is attached to. A book
 * attached to nothing is inert, and that is the most common reason an imported
 * world appears to do nothing at all.
 */
export function LorebookList({
  lorebooks,
  characters,
  loading,
  onCreate,
  onImport,
  onOpen,
  onDelete,
}: LorebookListProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (lorebooks.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookOpen />
          </EmptyMedia>
          <EmptyTitle>No lorebooks yet</EmptyTitle>
          <EmptyDescription>
            World facts that enter the prompt only when the conversation mentions them. Import one from SillyTavern,
            NovelAI, Agnai, RisuAI, or a character card.
          </EmptyDescription>
        </EmptyHeader>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onImport}>
            <Upload className="size-4" />
            Import a lorebook
          </Button>
          <Button onClick={onCreate}>
            <Plus className="size-4" />
            New lorebook
          </Button>
        </div>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm tabular-nums">
          {lorebooks.length} {lorebooks.length === 1 ? "lorebook" : "lorebooks"}
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onImport}>
            <Upload className="size-4" />
            Import
          </Button>
          <Button size="sm" onClick={onCreate}>
            <Plus className="size-4" />
            New lorebook
          </Button>
        </div>
      </div>

      <ul className="border-border divide-border divide-y rounded-md border">
        {lorebooks.map((lorebook) => {
          const attached = attachedNames(lorebook, characters);
          const format = formatLabel(lorebook.importFormat);
          return (
            <li key={lorebook.id} className="hover:bg-accent/40 flex items-center gap-3 p-3">
              <button
                type="button"
                className="focus-visible:ring-ring/50 min-w-0 flex-1 rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none"
                onClick={() => onOpen(lorebook)}
              >
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{lorebook.name || "Untitled lorebook"}</p>
                  {/*
                    An unattached book is the single most common reason an
                    imported world appears to do nothing, so it is called out
                    rather than left to be inferred from a missing line.
                  */}
                  {attached.length === 0 ? <Badge variant="outline">Not attached</Badge> : null}
                </div>
                <p className="text-muted-foreground line-clamp-1 text-sm tabular-nums">
                  {lorebook.entries.length} {lorebook.entries.length === 1 ? "entry" : "entries"}
                  {attached.length > 0 ? ` · ${attached.join(", ")}` : ""}
                  {format ? ` · ${format}` : ""}
                </p>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Delete ${lorebook.name || "lorebook"}`}
                onClick={() => onDelete(lorebook)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
