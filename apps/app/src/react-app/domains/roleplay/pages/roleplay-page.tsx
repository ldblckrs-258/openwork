/** @jsxImportSource react */
import type {
  RoleplayCharacterRecord,
  RoleplayPersona,
  RoleplayPersonaRecord,
} from "@openwork/types/roleplay";
import * as React from "react";

import type { ResolvedWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import {
  createBlankCharacter,
  createBlankPersona,
  createCharacterId,
  createPersonaId,
  duplicateCharacter,
} from "@/app/roleplay/character-draft";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/sonner";
import {
  useDeleteRoleplayCharacter,
  useRoleplayCharacters,
  useRoleplayPersonas,
  useSaveRoleplayCharacter,
  useSaveRoleplayPersona,
} from "../state/roleplay-queries";
import { CharacterEditor } from "./character-editor";
import { CharacterList } from "./character-list";
import { PersonaEditor } from "./persona-editor";

type RoleplayPageProps = {
  endpoint: ResolvedWorkspaceEndpoint | null;
  onStartChat?: (characterId: string, personaId: string) => Promise<void>;
};

const FALLBACK_PERSONA: RoleplayPersona = { name: "", description: "" };

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function RoleplayPage({ endpoint, onStartChat }: RoleplayPageProps) {
  const characters = useRoleplayCharacters(endpoint);
  const personas = useRoleplayPersonas(endpoint);
  const saveCharacter = useSaveRoleplayCharacter(endpoint);
  const deleteCharacter = useDeleteRoleplayCharacter(endpoint);
  const savePersona = useSaveRoleplayPersona(endpoint);

  const [editing, setEditing] = React.useState<RoleplayCharacterRecord | null>(
    null,
  );

  const personaRecord: RoleplayPersonaRecord = React.useMemo(
    () =>
      personas.data?.[0] ??
      createBlankPersona(
        createPersonaId(Date.now(), randomSuffix()),
        Date.now(),
      ),
    [personas.data],
  );

  const persist = (character: RoleplayCharacterRecord, message: string) => {
    saveCharacter.mutate(character, {
      onSuccess: () => {
        setEditing(null);
        toast.success(message);
      },
      onError: (error: unknown) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not save the character",
        ),
    });
  };

  if (!endpoint) {
    return (
      <p className="text-muted-foreground text-sm">
        Select a workspace to manage roleplay characters.
      </p>
    );
  }

  if (editing) {
    return (
      <CharacterEditor
        character={editing}
        persona={personaRecord.persona}
        saving={saveCharacter.isPending}
        onCancel={() => setEditing(null)}
        onSave={(character) => persist(character, "Character saved")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 px-10 py-6 max-w-3xl mx-auto">
      <CharacterList
        characters={characters.data ?? []}
        loading={characters.isLoading}
        onCreate={() =>
          setEditing(
            createBlankCharacter(
              createCharacterId(Date.now(), randomSuffix()),
              Date.now(),
            ),
          )
        }
        onOpen={(character) => setEditing(character)}
        onStartChat={
          onStartChat
            ? (character) => {
                // A character with no name compiles the fallback word "Character"
                // into its own description, so the editor blocks that save; a
                // chat cannot reach that state through the library.
                void onStartChat(character.id, personaRecord.id).catch(
                  (error: unknown) =>
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Could not start the chat",
                    ),
                );
              }
            : undefined
        }
        onDuplicate={(character) =>
          persist(
            duplicateCharacter(
              character,
              createCharacterId(Date.now(), randomSuffix()),
              Date.now(),
            ),
            "Character duplicated",
          )
        }
        onDelete={(character) => {
          deleteCharacter.mutate(character.id, {
            // Deleting tombstones the character so conversations that used it stay
            // readable; the library simply stops listing it.
            onSuccess: () =>
              toast.success(
                `${character.card.data.name || "Character"} deleted`,
              ),
            onError: (error: unknown) =>
              toast.error(
                error instanceof Error
                  ? error.message
                  : "Could not delete the character",
              ),
          });
        }}
      />

      <Separator />

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-medium">Your persona</h3>
          <p className="text-muted-foreground text-sm">
            Who you play. Characters use this to address you.
          </p>
        </div>
        <PersonaEditor
          persona={personaRecord}
          saving={savePersona.isPending}
          onSave={(persona) =>
            savePersona.mutate(persona, {
              onSuccess: () => toast.success("Persona saved"),
              onError: (error: unknown) =>
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Could not save the persona",
                ),
            })
          }
        />
      </section>

      {characters.isError ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-destructive text-sm">Could not load characters.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void characters.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export { FALLBACK_PERSONA };
