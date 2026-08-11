/** @jsxImportSource react */
import type { RoleplayCharacterRecord } from "@openwork/types/roleplay";
import {
  Brain,
  ChevronDown,
  Copy,
  Drama,
  History,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";

import type { RoleplayOpening } from "@/app/roleplay/greeting";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  /** How many lorebooks are attached to each character, keyed by character id. */
  lorebookCounts: Record<string, number>;
  onCreate: () => void;
  onOpen: (character: RoleplayCharacterRecord) => void;
  onDuplicate: (character: RoleplayCharacterRecord) => void;
  onDelete: (character: RoleplayCharacterRecord) => void;
  onStartChat?: (character: RoleplayCharacterRecord, opening: RoleplayOpening) => void;
  /** False when no engine is reachable, which is the only thing a written opening needs. */
  canWriteOpening: boolean;
  onGenerate?: () => void;
  onImport: () => void;
  onOpenMemories: (character: RoleplayCharacterRecord) => void;
  onOpenRevisions: (character: RoleplayCharacterRecord) => void;
};

/**
 * What a row says about a character beyond its name.
 *
 * Only facts that change how it behaves in a conversation: attached worlds, and
 * whether the card is still the author's work. A row of counts nobody acts on
 * would be decoration.
 */
/** One line of an alternate greeting, enough to tell them apart in a menu. */
function preview(greeting: string): string {
  const line = greeting.trim().split("\n")[0] ?? "";
  return line.length > 56 ? `${line.slice(0, 56)}…` : line;
}

function metaLine(character: RoleplayCharacterRecord, lorebooks: number): string {
  const parts: string[] = [];
  if (lorebooks > 0) parts.push(`${lorebooks} ${lorebooks === 1 ? "lorebook" : "lorebooks"}`);
  if (character.source === "imported") parts.push(character.revisedAt ? "imported, revised" : "imported");
  else if (character.revisedAt) parts.push("revised");
  return parts.join(" · ");
}

export function CharacterList({
  characters,
  loading,
  lorebookCounts,
  onCreate,
  onOpen,
  onDuplicate,
  onDelete,
  onStartChat,
  canWriteOpening,
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
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm tabular-nums">
          {characters.length} {characters.length === 1 ? "character" : "characters"}
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

      <ul className="border-border divide-border divide-y rounded-md border">
        {characters.map((character) => {
          const name = character.card.data.name || "Untitled character";
          const meta = metaLine(character, lorebookCounts[character.id] ?? 0);
          return (
            <li key={character.id} className="hover:bg-accent/40 flex items-center gap-3 p-3">
              {/*
                The whole row opens the editor. The two buttons on the right are
                the only things that do anything else, so a row-wide target costs
                nothing and saves aiming at a link-sized name.
              */}
              <button
                type="button"
                className="focus-visible:ring-ring/50 min-w-0 flex-1 rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none"
                onClick={() => onOpen(character)}
              >
                <p className="truncate text-sm font-medium">{name}</p>
                <p className="text-muted-foreground line-clamp-1 text-sm">
                  {character.card.data.description || "No description yet."}
                </p>
                {meta ? <p className="text-muted-foreground mt-1 text-xs tabular-nums">{meta}</p> : null}
              </button>

              {onStartChat ? (
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" onClick={() => onStartChat(character, { kind: "card" })}>
                    <MessageCircle className="size-4" />
                    Chat
                  </Button>
                  {/*
                    A separate trigger rather than a menu the Chat button itself
                    opens: starting a chat the usual way stays one click, and the
                    openings sit one click away instead of in front of it.
                  */}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Start a chat with ${name} from a different opening`}
                        >
                          <ChevronDown className="size-4" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end">
                      {/*
                        The label is a group part: base-ui throws if it renders
                        outside a group, which takes the whole renderer down with
                        it rather than degrading.
                      */}
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>Open the scene with</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => onStartChat(character, { kind: "card" })}>
                          <Drama className="size-4" />
                          {character.card.data.first_mes.trim() ? "The card's greeting" : "No greeting"}
                        </DropdownMenuItem>
                        {character.card.data.alternate_greetings
                          .filter((greeting) => greeting.trim())
                          .map((greeting, index) => (
                            <DropdownMenuItem
                              key={`alternate-${index}`}
                              onClick={() => onStartChat(character, { kind: "alternate", text: greeting })}
                            >
                              <MessageCircle className="size-4" />
                              <span className="truncate">{preview(greeting)}</span>
                            </DropdownMenuItem>
                          ))}
                        <DropdownMenuSeparator />
                        {/*
                          The point of this menu. A card's greeting was written for
                          a first meeting, so once the character remembers things it
                          opens by re-introducing someone they already know.
                        */}
                        <DropdownMenuItem
                          disabled={!canWriteOpening}
                          onClick={() => onStartChat(character, { kind: "generate" })}
                        >
                          <Sparkles className="size-4" />
                          A fresh opening from what they remember
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : null}

              {/*
                Five bare icon buttons per row was five unlabelled guesses. One
                menu names every action and leaves the row's only emphasis on the
                thing people came here to do.
              */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button type="button" variant="ghost" size="icon" aria-label={`More actions for ${name}`}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onOpen(character)}>
                    <Pencil className="size-4" />
                    Edit character
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenMemories(character)}>
                    <Brain className="size-4" />
                    Memories
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenRevisions(character)}>
                    <History className="size-4" />
                    Revision history
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onDuplicate(character)}>
                    <Copy className="size-4" />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => onDelete(character)}>
                    <Trash2 className="size-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
