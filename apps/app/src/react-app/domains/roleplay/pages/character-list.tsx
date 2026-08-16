/** @jsxImportSource react */
import type { RoleplayCharacterRecord } from "@openwork/types/roleplay";
import {
  Brain,
  ChevronDown,
  Copy,
  Drama,
  Eye,
  EyeOff,
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
  safeMode: boolean;
  hiddenCount: number;
  onChangeSafeMode: (safeMode: boolean) => void;
  lorebookCounts: Record<string, number>;
  onCreate: () => void;
  onOpen: (character: RoleplayCharacterRecord) => void;
  onDuplicate: (character: RoleplayCharacterRecord) => void;
  onDelete: (character: RoleplayCharacterRecord) => void;
  onStartChat?: (character: RoleplayCharacterRecord, opening: RoleplayOpening) => void;
  canWriteOpening: boolean;
  onGenerate?: () => void;
  onImport: () => void;
  onOpenMemories: (character: RoleplayCharacterRecord) => void;
  onOpenRevisions: (character: RoleplayCharacterRecord) => void;
};

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
  safeMode,
  hiddenCount,
  onChangeSafeMode,
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

  if (characters.length === 0 && hiddenCount > 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <EyeOff />
          </EmptyMedia>
          <EmptyTitle>Safe mode is on</EmptyTitle>
          <EmptyDescription>
            {hiddenCount} {hiddenCount === 1 ? "character is" : "characters are"} hidden. Nothing has been deleted.
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" onClick={() => onChangeSafeMode(false)}>
          <Eye className="size-4" />
          Show them
        </Button>
      </Empty>
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
          {hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ""}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={safeMode}
            title={safeMode ? "Safe mode is on" : "Safe mode is off"}
            onClick={() => onChangeSafeMode(!safeMode)}
          >
            {safeMode ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            Safe mode
          </Button>
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
