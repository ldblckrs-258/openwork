/** @jsxImportSource react */
import type { RoleplayCardRevision, RoleplayCharacterRecord } from "@openwork/types/roleplay";
import { Undo2 } from "lucide-react";
import * as React from "react";

import type { ResolvedWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import { createRevisionId, driftFromOriginal, rollbackTo } from "@/app/roleplay/revise";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/sonner";
import { useApplyRoleplayRevision, useRoleplayRevisions } from "../state/roleplay-queries";

type CharacterRevisionsProps = {
  endpoint: ResolvedWorkspaceEndpoint | null;
  character: RoleplayCharacterRecord;
  onBack: () => void;
};

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function when(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function CharacterRevisions({ endpoint, character, onBack }: CharacterRevisionsProps) {
  const revisions = useRoleplayRevisions(endpoint, character.id);
  const applyRevision = useApplyRoleplayRevision(endpoint);

  const entries = revisions.data ?? [];
  const drift = driftFromOriginal(character, entries);

  const undo = (revision: RoleplayCardRevision) => {
    const rolled = rollbackTo({
      character,
      revision,
      revisionId: createRevisionId(Date.now(), randomSuffix()),
      now: Date.now(),
    });
    applyRevision.mutate(
      { revision: rolled.revision, character: rolled.character },
      {
        onSuccess: () => toast.success("Card restored"),
        onError: (error: unknown) =>
          toast.error(error instanceof Error ? error.message : "Could not restore the card"),
      },
    );
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-10 py-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">
            Revisions to {character.card.data.name || "this character"}
          </h3>
          <p className="text-muted-foreground text-sm">
            Every applied change, and the card as it was before it.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
      </div>

      {character.source === "imported" && character.revisedAt ? (
        <p className="text-muted-foreground text-sm">
          This started as an imported card and has been changed since. An export of it is your version, not the
          original author&apos;s.
        </p>
      ) : null}

      {drift && drift.changedFields.length > 0 ? (
        <p className="text-sm">
          Changed from the original in: {drift.changedFields.join(", ")}.
        </p>
      ) : null}

      <Separator />

      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No revisions yet. When a conversation suggests a change to the card, you review it before anything is
          applied.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {[...entries].reverse().map((revision) => (
            <li key={revision.id} className="border-border flex items-center gap-3 rounded-md border p-3">
              <div className="flex-1">
                <p className="text-sm">
                  {revision.changedFields.length > 0
                    ? `Changed ${revision.changedFields.join(", ")}`
                    : "Card replaced"}
                </p>
                <p className="text-muted-foreground text-sm">{when(revision.createdAt)}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={applyRevision.isPending}
                aria-label={`Restore the card from ${when(revision.createdAt)}`}
                onClick={() => undo(revision)}
              >
                <Undo2 className="size-4" />
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
