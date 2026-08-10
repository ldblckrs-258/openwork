/** @jsxImportSource react */
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { CharacterCardDataV2, RoleplayCharacterRecord, RoleplayPersona } from "@openwork/types/roleplay";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { applyCardEdit, validateCharacter, type CharacterFieldError } from "@/app/roleplay/character-draft";
import { CompiledPromptDebug } from "../components/compiled-prompt-debug";
import { ExampleDialogueEditor } from "../components/example-dialogue-editor";

type CharacterEditorProps = {
  character: RoleplayCharacterRecord;
  persona: RoleplayPersona;
  saving: boolean;
  onSave: (character: RoleplayCharacterRecord) => void;
  onCancel: () => void;
};

function errorFor(errors: CharacterFieldError[], field: string) {
  return errors.find((error) => error.field === field)?.message;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-destructive text-sm">{message}</p>;
}

export function CharacterEditor({ character, persona, saving, onSave, onCancel }: CharacterEditorProps) {
  const [draft, setDraft] = React.useState(character);
  const [errors, setErrors] = React.useState<CharacterFieldError[]>([]);

  React.useEffect(() => setDraft(character), [character]);

  const edit = (change: Partial<CharacterCardDataV2>) => setDraft((current) => applyCardEdit(current, change, Date.now()));
  const data = draft.card.data;

  const submit = () => {
    const found = validateCharacter(draft);
    setErrors(found);
    // Surfacing field-level errors rather than failing the save silently: a card
    // that vanishes on save with no explanation is the worst outcome here.
    if (found.length === 0) onSave(draft);
  };

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="character-name">Name</Label>
          <Input
            id="character-name"
            value={data.name}
            placeholder="Aria"
            onChange={(event) => edit({ name: event.target.value })}
          />
          <FieldError message={errorFor(errors, "name")} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="character-description">Description</Label>
          <Textarea
            id="character-description"
            rows={6}
            value={data.description}
            placeholder="Who they are, how they carry themselves, what they want."
            onChange={(event) => edit({ description: event.target.value })}
          />
          <FieldError message={errorFor(errors, "description")} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="character-first-mes">First message</Label>
          <Textarea
            id="character-first-mes"
            rows={3}
            value={data.first_mes}
            placeholder="You're late."
            onChange={(event) => edit({ first_mes: event.target.value })}
          />
          <p className="text-muted-foreground text-sm">The character speaks first. This is the line they open with.</p>
          <FieldError message={errorFor(errors, "first_mes")} />
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-medium">Voice</h3>
          <p className="text-muted-foreground text-sm">How they sound and where the scene starts.</p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="character-personality">Personality</Label>
          <Textarea
            id="character-personality"
            rows={3}
            value={data.personality}
            placeholder="Curious, dry-witted, allergic to small talk."
            onChange={(event) => edit({ personality: event.target.value })}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="character-scenario">Scenario</Label>
          <Textarea
            id="character-scenario"
            rows={3}
            value={data.scenario}
            placeholder="A rain-soaked library, ten minutes past closing."
            onChange={(event) => edit({ scenario: event.target.value })}
          />
        </div>

        <ExampleDialogueEditor value={data.mes_example} onChange={(mesExample) => edit({ mes_example: mesExample })} />

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Alternate greetings</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => edit({ alternate_greetings: [...data.alternate_greetings, ""] })}
            >
              <Plus className="size-4" />
              Add greeting
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">Other ways the character could open the scene.</p>
          {data.alternate_greetings.map((greeting, index) => (
            <div key={index} className="flex items-start gap-2">
              <Textarea
                rows={2}
                value={greeting}
                onChange={(event) => {
                  const next = [...data.alternate_greetings];
                  next[index] = event.target.value;
                  edit({ alternate_greetings: next });
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove greeting ${index + 1}`}
                onClick={() => edit({ alternate_greetings: data.alternate_greetings.filter((_, position) => position !== index) })}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-2">
        <Label htmlFor="character-phi">Post-history instructions</Label>
        <Textarea id="character-phi" rows={2} value={data.post_history_instructions} disabled readOnly />
        {/*
          Shown disabled rather than hidden. Imported community cards often set
          this field, and its whole meaning is that it lands after chat history —
          which this engine cannot do, because the per-prompt system string is
          appended before history. Hiding it would leave a user wondering why a
          card behaves differently here; editing it would let them write text that
          silently never reaches the model.
        */}
        <p className="text-muted-foreground text-sm">
          Not supported. This engine places the system prompt before chat history, so these instructions can never take
          effect. The text is preserved on export.
        </p>
      </section>

      <Separator />

      <CompiledPromptDebug character={draft} persona={persona} />

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save character"}
        </Button>
      </div>
    </form>
  );
}
