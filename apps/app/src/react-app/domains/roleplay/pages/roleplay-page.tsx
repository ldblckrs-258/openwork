/** @jsxImportSource react */
import type {
  RoleplayCharacterRecord,
  RoleplayLorebookRecord,
  RoleplayPersona,
  RoleplayPersonaRecord,
} from "@openwork/types/roleplay";
import { BookOpen, Drama, UserRound } from "lucide-react";
import * as React from "react";

import type { ResolvedWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import {
  createBlankCharacter,
  createBlankPersona,
  createCharacterId,
  createPersonaId,
  duplicateCharacter,
} from "@/app/roleplay/character-draft";
import type { GenerationRequest } from "@/app/roleplay/generation/prompts";
import type { RoleplayOpening } from "@/app/roleplay/greeting";
import { createBlankLorebook, createLorebookId } from "@/app/roleplay/lorebook";
import { resolveSafeMode, visibleCharacters } from "@/app/roleplay/safe-mode";
import { useLocal } from "@/react-app/kernel/local-provider";
import { importedLorebookRecord, lorebookFromCharacterBook } from "@/app/roleplay/lorebook-import";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useDeleteRoleplayCharacter,
  useDeleteRoleplayLorebook,
  useRoleplayCharacters,
  useRoleplayLorebooks,
  useRoleplayPersonas,
  useSaveRoleplayCharacter,
  useSaveRoleplayLorebook,
  useSaveRoleplayPersona,
  useWorkspaceSkills,
} from "../state/roleplay-queries";
import { CharacterEditor } from "./character-editor";
import { CharacterGenerate } from "./character-generate";
import { CharacterImport } from "./character-import";
import { CharacterList } from "./character-list";
import { CharacterMemories } from "./character-memories";
import { CharacterRevisions } from "./character-revisions";
import { LorebookEditor } from "./lorebook-editor";
import { LorebookImport } from "./lorebook-import";
import { LorebookList } from "./lorebook-list";
import { PersonaEditor } from "./persona-editor";

type RoleplayPageProps = {
  endpoint: ResolvedWorkspaceEndpoint | null;
  onStartChat?: (characterId: string, personaId: string, opening: RoleplayOpening) => Promise<void>;
  onRunGeneration?: (request: GenerationRequest) => Promise<string>;
};

const FALLBACK_PERSONA: RoleplayPersona = { name: "", description: "" };

const EMPTY_CHARACTERS: RoleplayCharacterRecord[] = [];

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function RoleplayPage({ endpoint, onStartChat, onRunGeneration }: RoleplayPageProps) {
  const characters = useRoleplayCharacters(endpoint);
  const local = useLocal();
  const allCharacters = characters.data ?? EMPTY_CHARACTERS;
  const safeMode = resolveSafeMode(local.prefs.roleplaySafeMode, allCharacters);
  const shownCharacters = visibleCharacters(allCharacters, safeMode);
  const personas = useRoleplayPersonas(endpoint);
  const workspaceSkills = useWorkspaceSkills(endpoint);
  const saveCharacter = useSaveRoleplayCharacter(endpoint);
  const deleteCharacter = useDeleteRoleplayCharacter(endpoint);
  const savePersona = useSaveRoleplayPersona(endpoint);
  const lorebooks = useRoleplayLorebooks(endpoint);
  const saveLorebook = useSaveRoleplayLorebook(endpoint);
  const deleteLorebook = useDeleteRoleplayLorebook(endpoint);

  const [editing, setEditing] = React.useState<RoleplayCharacterRecord | null>(
    null,
  );
  const [generating, setGenerating] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [editingLorebook, setEditingLorebook] = React.useState<RoleplayLorebookRecord | null>(null);
  const [importingLorebook, setImportingLorebook] = React.useState(false);
  const [tab, setTab] = React.useState("characters");
  const [pendingLorebook, setPendingLorebook] = React.useState<RoleplayLorebookRecord | null>(null);
  const [remembering, setRemembering] = React.useState<RoleplayCharacterRecord | null>(null);
  const [reviewingRevisions, setReviewingRevisions] = React.useState<RoleplayCharacterRecord | null>(null);

  const personaRecord: RoleplayPersonaRecord = React.useMemo(
    () =>
      personas.data?.[0] ??
      createBlankPersona(
        createPersonaId(Date.now(), randomSuffix()),
        Date.now(),
      ),
    [personas.data],
  );

  const characterCount = characters.data?.length ?? 0;
  const lorebookCount = lorebooks.data?.length ?? 0;
  const lorebookCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const book of lorebooks.data ?? []) {
      for (const characterId of book.characterIds) {
        counts[characterId] = (counts[characterId] ?? 0) + 1;
      }
    }
    return counts;
  }, [lorebooks.data]);

  const persist = (character: RoleplayCharacterRecord, message: string) => {
    saveCharacter.mutate(character, {
      onSuccess: () => {
        setEditing(null);
        if (pendingLorebook?.characterIds.includes(character.id)) {
          const book = pendingLorebook;
          setPendingLorebook(null);
          saveLorebook.mutate(book, {
            onSuccess: () =>
              toast.success(`Saved the lorebook that came with ${character.card.data.name || "the card"}`, {
                description: `${book.entries.length} ${book.entries.length === 1 ? "entry" : "entries"}, attached to this character.`,
              }),
            onError: (error: unknown) =>
              toast.error(
                error instanceof Error ? error.message : "Could not save the card's lorebook",
              ),
          });
        }
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
        safeMode={safeMode}
        skills={workspaceSkills.data ?? []}
        endpoint={endpoint}
        onCancel={() => setEditing(null)}
        onSave={(character) => persist(character, "Character saved")}
      />
    );
  }

  if (reviewingRevisions) {
    return (
      <CharacterRevisions
        endpoint={endpoint}
        character={
          characters.data?.find((entry) => entry.id === reviewingRevisions.id) ?? reviewingRevisions
        }
        onBack={() => setReviewingRevisions(null)}
      />
    );
  }

  if (remembering) {
    return (
      <CharacterMemories
        endpoint={endpoint}
        character={remembering}
        onBack={() => setRemembering(null)}
      />
    );
  }

  if (editingLorebook) {
    return (
      <LorebookEditor
        lorebook={editingLorebook}
        characters={characters.data ?? []}
        saving={saveLorebook.isPending}
        onCancel={() => setEditingLorebook(null)}
        onSave={(lorebook) =>
          saveLorebook.mutate(lorebook, {
            onSuccess: () => {
              setEditingLorebook(null);
              toast.success("Lorebook saved");
            },
            onError: (error: unknown) =>
              toast.error(error instanceof Error ? error.message : "Could not save the lorebook"),
          })
        }
      />
    );
  }

  if (importingLorebook) {
    return (
      <LorebookImport
        onImported={(lorebook, losses) => {
          setImportingLorebook(false);
          setEditingLorebook(lorebook);
          if (losses.length > 0) {
            toast.warning(`Imported ${lorebook.name} with changes`, {
              description: losses.join(" "),
              duration: 12_000,
            });
          } else {
            toast.success(`Imported ${lorebook.name}`);
          }
        }}
        onCancel={() => setImportingLorebook(false)}
      />
    );
  }

  if (importing) {
    return (
      <CharacterImport
        onImported={(character, losses) => {
          setImporting(false);
          setEditing(character);
          const book = character.card.data.character_book;
          setPendingLorebook(
            book && book.entries.length > 0
              ? importedLorebookRecord(
                  lorebookFromCharacterBook(book, `${character.card.data.name || "Imported"} lorebook`),
                  {
                    id: createLorebookId(Date.now(), randomSuffix()),
                    now: Date.now(),
                    characterIds: [character.id],
                    format: "character_book",
                    fallbackName: `${character.card.data.name || "Imported"} lorebook`,
                  },
                )
              : null,
          );
          if (losses.length > 0) {
            toast.warning(`Imported ${character.card.data.name || "character"} with changes`, {
              description: losses.join(" "),
              duration: 12_000,
            });
          } else {
            toast.success(`Imported ${character.card.data.name || "character"}`);
          }
        }}
        onCancel={() => setImporting(false)}
      />
    );
  }

  if (generating && onRunGeneration) {
    return (
      <CharacterGenerate
        onRun={onRunGeneration}
        onGenerated={(character) => {
          setGenerating(false);
          setEditing(character);
        }}
        onCancel={() => setGenerating(false)}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-10 py-6">
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="characters" className="flex-none">
            <Drama />
            Characters
            <span className="text-muted-foreground text-xs tabular-nums">{characterCount}</span>
          </TabsTrigger>
          <TabsTrigger value="lorebooks" className="flex-none">
            <BookOpen />
            Lorebooks
            <span className="text-muted-foreground text-xs tabular-nums">{lorebookCount}</span>
          </TabsTrigger>
          <TabsTrigger value="persona" className="flex-none">
            <UserRound />
            Persona
          </TabsTrigger>
        </TabsList>

        <TabsContent value="characters" className="flex flex-col gap-4">
          <CharacterList
            characters={shownCharacters}
            loading={characters.isLoading}
            safeMode={safeMode}
            hiddenCount={allCharacters.length - shownCharacters.length}
            onChangeSafeMode={(next) => local.setPrefs((previous) => ({ ...previous, roleplaySafeMode: next }))}
            lorebookCounts={lorebookCounts}
            onCreate={() =>
              setEditing(createBlankCharacter(createCharacterId(Date.now(), randomSuffix()), Date.now()))
            }
            onOpen={(character) => setEditing(character)}
            onGenerate={onRunGeneration ? () => setGenerating(true) : undefined}
            onImport={() => setImporting(true)}
            onOpenMemories={(character) => setRemembering(character)}
            onOpenRevisions={(character) => setReviewingRevisions(character)}
            canWriteOpening={Boolean(onRunGeneration)}
            onStartChat={
              onStartChat
                ? (character, opening) => {
                    void onStartChat(character.id, personaRecord.id, opening).catch((error: unknown) =>
                      toast.error(error instanceof Error ? error.message : "Could not start the chat"),
                    );
                  }
                : undefined
            }
            onDuplicate={(character) =>
              persist(
                duplicateCharacter(character, createCharacterId(Date.now(), randomSuffix()), Date.now()),
                "Character duplicated",
              )
            }
            onDelete={(character) => {
              deleteCharacter.mutate(character.id, {
                onSuccess: () => toast.success(`${character.card.data.name || "Character"} deleted`),
                onError: (error: unknown) =>
                  toast.error(error instanceof Error ? error.message : "Could not delete the character"),
              });
            }}
          />

          {characters.isError ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-destructive text-sm">Could not load characters.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void characters.refetch()}>
                Retry
              </Button>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="lorebooks" className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            World facts a character only sees when the conversation mentions them. Attach a book to a character to
            put it in play.
          </p>

          <LorebookList
            lorebooks={lorebooks.data ?? []}
            characters={characters.data ?? []}
            loading={lorebooks.isLoading}
            onCreate={() =>
              setEditingLorebook(createBlankLorebook(createLorebookId(Date.now(), randomSuffix()), Date.now()))
            }
            onImport={() => setImportingLorebook(true)}
            onOpen={(lorebook) => setEditingLorebook(lorebook)}
            onDelete={(lorebook) =>
              deleteLorebook.mutate(lorebook.id, {
                onSuccess: () => toast.success(`${lorebook.name || "Lorebook"} deleted`),
                onError: (error: unknown) =>
                  toast.error(error instanceof Error ? error.message : "Could not delete the lorebook"),
              })
            }
          />

          {lorebooks.isError ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-destructive text-sm">Could not load lorebooks.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void lorebooks.refetch()}>
                Retry
              </Button>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="persona" className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            Who you play. Every character reads this, and your name is what they call you.
          </p>
          <PersonaEditor
            persona={personaRecord}
            saving={savePersona.isPending}
            onSave={(persona) =>
              savePersona.mutate(persona, {
                onSuccess: () => toast.success("Persona saved"),
                onError: (error: unknown) =>
                  toast.error(
                    error instanceof Error ? error.message : "Could not save the persona",
                  ),
              })
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export { FALLBACK_PERSONA };
