/** @jsxImportSource react */
import type { RoleplayCharacterRecord } from "@openwork/types/roleplay";
import { Brain, Copy, Drama, History, MessageCircle, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

type CharacterListProps = {
  characters: RoleplayCharacterRecord[];
  loading: boolean;
  onCreate: () => void;
  onOpen: (character: RoleplayCharacterRecord) => void;
  onDuplicate: (character: RoleplayCharacterRecord) => void;
  onDelete: (character: RoleplayCharacterRecord) => void;
  onStartChat?: (character: RoleplayCharacterRecord) => void;
  onGenerate?: () => void;
  onImport: () => void;
  onOpenMemories: (character: RoleplayCharacterRecord) => void;
  onOpenRevisions: (character: RoleplayCharacterRecord) => void;
};

export function CharacterList({
  characters,
  loading,
  onCreate,
  onOpen,
  onDuplicate,
  onDelete,
  onStartChat,
  onGenerate,
  onImport,
  onOpenMemories,
  onOpenRevisions,
}: CharacterListProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (characters.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Drama />
          </EmptyMedia>
          <EmptyTitle>No characters yet</EmptyTitle>
          <EmptyDescription>
            Create a character to start a roleplay conversation.
          </EmptyDescription>
        </EmptyHeader>
        <div className="flex items-center gap-2">
          {onGenerate ? (
            <Button onClick={onGenerate}>
              <Sparkles className="size-4" />
              Generate one
            </Button>
          ) : null}
          <Button variant="outline" onClick={onImport}>
            <Upload className="size-4" />
            Import a card
          </Button>
          <Button variant={onGenerate ? "outline" : "default"} onClick={onCreate}>
            <Plus className="size-4" />
            New character
          </Button>
        </div>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3  px-10 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {characters.length}{" "}
          {characters.length === 1 ? "character" : "characters"}
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onImport}>
            <Upload className="size-4" />
            Import
          </Button>
          {onGenerate ? (
            <Button size="sm" variant="outline" onClick={onGenerate}>
              <Sparkles className="size-4" />
              Generate
            </Button>
          ) : null}
          <Button size="sm" onClick={onCreate}>
            <Plus className="size-4" />
            New character
          </Button>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {characters.map((character) => (
          <li
            key={character.id}
            className="border-border flex items-center gap-3 rounded-md border p-3"
          >
            <button
              type="button"
              className="flex-1 text-left"
              onClick={() => onOpen(character)}
            >
              <p className="text-sm font-medium">
                {character.card.data.name || "Untitled character"}
              </p>
              <p className="text-muted-foreground line-clamp-1 text-sm">
                {character.card.data.description || "No description yet."}
              </p>
            </button>
            {onStartChat ? (
              <Button
                type="button"
                size="sm"
                onClick={() => onStartChat(character)}
              >
                <MessageCircle className="size-4" />
                Chat
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Memories for ${character.card.data.name}`}
              onClick={() => onOpenMemories(character)}
            >
              <Brain className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Revisions to ${character.card.data.name}`}
              onClick={() => onOpenRevisions(character)}
            >
              <History className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Duplicate ${character.card.data.name}`}
              onClick={() => onDuplicate(character)}
            >
              <Copy className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Delete ${character.card.data.name}`}
              onClick={() => onDelete(character)}
            >
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
