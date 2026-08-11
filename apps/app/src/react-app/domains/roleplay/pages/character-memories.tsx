/** @jsxImportSource react */
import type { RoleplayCharacterRecord, RoleplayMemoryRecord } from "@openwork/types/roleplay";
import { Plus, Trash2 } from "lucide-react";
import * as React from "react";

import type { ResolvedWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import { createMemory, createMemoryId, editMemory, MAX_MEMORY_CHARS, selectMemories } from "@/app/roleplay/memory";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import {
  useDeleteRoleplayMemory,
  useRoleplayMemories,
  useSaveRoleplayMemory,
} from "../state/roleplay-queries";

type CharacterMemoriesProps = {
  endpoint: ResolvedWorkspaceEndpoint | null;
  character: RoleplayCharacterRecord;
  onBack: () => void;
};

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * What this character knows across sessions.
 *
 * Everything on this page is already approved — proposals never reach the store,
 * so there is no pending state to render here. Editing rewrites the text the
 * model will read verbatim, which is why the entry is a plain textarea rather
 * than anything that reformats what the user typed.
 */
export function CharacterMemories({ endpoint, character, onBack }: CharacterMemoriesProps) {
  const memories = useRoleplayMemories(endpoint, character.id);
  const saveMemory = useSaveRoleplayMemory(endpoint);
  const deleteMemory = useDeleteRoleplayMemory(endpoint);
  const [draft, setDraft] = React.useState("");

  const entries = memories.data ?? [];
  const selection = selectMemories(entries);

  const add = () => {
    if (!draft.trim()) return;
    saveMemory.mutate(
      createMemory({
        id: createMemoryId(Date.now(), randomSuffix()),
        characterId: character.id,
        text: draft,
        source: "user",
        now: Date.now(),
      }),
      {
        onSuccess: () => setDraft(""),
        onError: (error: unknown) =>
          toast.error(error instanceof Error ? error.message : "Could not save the memory"),
      },
    );
  };

  const rewrite = (memory: RoleplayMemoryRecord, text: string) => {
    if (text === memory.text) return;
    saveMemory.mutate(editMemory(memory, text, Date.now()));
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-10 py-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">
            What {character.card.data.name || "this character"} remembers
          </h3>
          <p className="text-muted-foreground text-sm">
            Carried into every conversation with them. One fact per entry, up to {MAX_MEMORY_CHARS} characters.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Textarea
          rows={2}
          value={draft}
          placeholder="Wren works nights at the harbour and will not say why."
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex justify-end">
          <Button type="button" size="sm" disabled={!draft.trim() || saveMemory.isPending} onClick={add}>
            <Plus className="size-4" />
            Remember this
          </Button>
        </div>
      </div>

      <Separator />

      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing yet. Add a fact above, or let the character propose what it learned after a conversation.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((memory) => (
            <li key={memory.id} className="flex items-start gap-2">
              <Textarea
                rows={2}
                defaultValue={memory.text}
                aria-label={`Memory: ${memory.text}`}
                onBlur={(event) => rewrite(memory, event.target.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Forget: ${memory.text}`}
                onClick={() =>
                  deleteMemory.mutate({ memoryId: memory.id, characterId: character.id })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {selection.dropped > 0 ? (
        // Said out loud rather than silently trimmed at send time: a user who
        // adds a thirtieth memory and sees no change in behaviour would otherwise
        // conclude the feature does not work.
        <p className="text-muted-foreground text-sm">
          {selection.dropped} {selection.dropped === 1 ? "memory does" : "memories do"} not fit the prompt budget and
          {selection.dropped === 1 ? " is" : " are"} not being sent. Delete or shorten some to make room.
        </p>
      ) : null}
    </div>
  );
}
