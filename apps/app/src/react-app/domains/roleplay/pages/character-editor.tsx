/** @jsxImportSource react */
import type {
  CharacterCardDataV2,
  RoleplayCharacterRecord,
  RoleplayPersona,
} from "@openwork/types/roleplay";
import { Plus, Trash2 } from "lucide-react";
import * as React from "react";

import {
  applyCardEdit,
  validateCharacter,
  type CharacterFieldError,
} from "@/app/roleplay/character-draft";
import { MAX_ATTACHED_SKILLS, SKILL_BUDGET_CHARS, selectSkillInjections } from "@/app/roleplay/skills-injection";
import type { OpenworkSkillItem } from "@/app/lib/openwork-server";
import type { ResolvedWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import { useAttachedSkillBodies } from "../state/roleplay-queries";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { CharacterExport } from "../components/character-export";
import { CompiledPromptDebug } from "../components/compiled-prompt-debug";
import { ExampleDialogueEditor } from "../components/example-dialogue-editor";

type CharacterEditorProps = {
  character: RoleplayCharacterRecord;
  persona: RoleplayPersona;
  saving: boolean;
  /** Project and global skills, as `listSkills` resolved them. */
  skills: OpenworkSkillItem[];
  /** Reads the bodies of the attached skills, so the editor can size them. */
  endpoint: ResolvedWorkspaceEndpoint | null;
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

export function CharacterEditor({
  character,
  persona,
  saving,
  skills,
  endpoint,
  onSave,
  onCancel,
}: CharacterEditorProps) {
  const [draft, setDraft] = React.useState(character);
  const [errors, setErrors] = React.useState<CharacterFieldError[]>([]);

  React.useEffect(() => setDraft(character), [character]);

  const edit = (change: Partial<CharacterCardDataV2>) =>
    setDraft((current) => applyCardEdit(current, change, Date.now()));
  const data = draft.card.data;

  const attached = draft.attachedSkills;
  /**
   * What the next turn would actually inject, run through the same function the
   * turn runs. The budget fills in attach order and cuts whatever straddles the
   * boundary, so a large skill attached first can leave a later one nothing —
   * shown here rather than discovered after a send, in the diagnostics panel.
   */
  const attachedBodies = useAttachedSkillBodies(endpoint, attached);
  const selection = React.useMemo(
    () => selectSkillInjections(attachedBodies.skills),
    [attachedBodies.skills],
  );
  const injectedChars = new Map(selection.injections.map((entry) => [entry.name, entry.body.length]));
  const cutNames = new Set(selection.truncated);
  const droppedNames = new Set(selection.dropped);
  /**
   * A ref is attached by name *and* scope, so an attached global skill that a
   * project one later shadows shows as attached and reports as unresolved on the
   * next turn — rather than silently swapping which file the character writes
   * under.
   */
  const isAttached = (skill: OpenworkSkillItem) =>
    attached.some((ref) => ref.name === skill.name && ref.scope === skill.scope);
  const attachedElsewhere = attached.filter(
    (ref) => !skills.some((skill) => skill.name === ref.name && skill.scope === ref.scope),
  );
  const toggleSkill = (skill: OpenworkSkillItem) =>
    setDraft((current) => ({
      ...current,
      attachedSkills: current.attachedSkills.some(
        (ref) => ref.name === skill.name && ref.scope === skill.scope,
      )
        ? current.attachedSkills.filter((ref) => !(ref.name === skill.name && ref.scope === skill.scope))
        : [...current.attachedSkills, { name: skill.name, scope: skill.scope }],
      updatedAt: Date.now(),
    }));

  const submit = () => {
    const found = validateCharacter(draft);
    setErrors(found);
    // Surfacing field-level errors rather than failing the save silently: a card
    // that vanishes on save with no explanation is the worst outcome here.
    if (found.length === 0) onSave(draft);
  };

  return (
    <form
      className="flex flex-col gap-6  px-10 py-6 max-w-3xl mx-auto"
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
          <p className="text-muted-foreground text-sm">
            The character speaks first. This is the line they open with.
          </p>
          <FieldError message={errorFor(errors, "first_mes")} />
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-medium">Voice</h3>
          <p className="text-muted-foreground text-sm">
            How they sound and where the scene starts.
          </p>
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

        <ExampleDialogueEditor
          value={data.mes_example}
          onChange={(mesExample) => edit({ mes_example: mesExample })}
        />

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Alternate greetings</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                edit({ alternate_greetings: [...data.alternate_greetings, ""] })
              }
            >
              <Plus className="size-4" />
              Add greeting
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">
            Other ways the character could open the scene.
          </p>
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
                onClick={() =>
                  edit({
                    alternate_greetings: data.alternate_greetings.filter(
                      (_, position) => position !== index,
                    ),
                  })
                }
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
        <Textarea
          id="character-phi"
          rows={2}
          value={data.post_history_instructions}
          disabled
          readOnly
        />
        {/*
          Shown disabled rather than hidden. Imported community cards often set
          this field, and its whole meaning is that it lands after chat history —
          which this engine cannot do, because the per-prompt system string is
          appended before history. Hiding it would leave a user wondering why a
          card behaves differently here; editing it would let them write text that
          silently never reaches the model.
        */}
        <p className="text-muted-foreground text-sm">
          Not supported. This engine places the system prompt before chat
          history, so these instructions can never take effect. The text is
          preserved on export.
        </p>
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-medium">Writing guidance</h3>
          <p className="text-muted-foreground text-sm">
            Workspace skills injected into every turn as guidance on how to write — narration style, pacing, content
            rules. Text only: the character cannot run a skill. Up to {MAX_ATTACHED_SKILLS}.
          </p>
        </div>
        {skills.length === 0 ? (
          <p className="text-muted-foreground text-sm">No skills in this workspace.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {skills.map((skill) => (
              <li key={`${skill.scope}:${skill.name}`}>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={isAttached(skill)}
                    disabled={!isAttached(skill) && attached.length >= MAX_ATTACHED_SKILLS}
                    onCheckedChange={() => toggleSkill(skill)}
                  />
                  <span className="min-w-0 flex-1">
                    {skill.name}
                    <span className="text-muted-foreground ms-1">{skill.scope}</span>
                    {isAttached(skill) && !attachedBodies.pending ? (
                      droppedNames.has(skill.name) ? (
                        <span className="text-amber-11 ms-1 text-xs tabular-nums">
                          no room left — nothing of this reaches the prompt
                        </span>
                      ) : (
                        <span className="text-muted-foreground ms-1 text-xs tabular-nums">
                          {(injectedChars.get(skill.name) ?? 0).toLocaleString()} chars
                          {cutNames.has(skill.name) ? " · cut to fit" : ""}
                        </span>
                      )
                    ) : null}
                    {skill.description ? (
                      <span className="text-muted-foreground block text-xs">{skill.description}</span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {attached.length > 0 && !attachedBodies.pending ? (
          <p
            className={
              selection.dropped.length > 0 || selection.truncated.length > 0
                ? "text-amber-11 text-xs tabular-nums"
                : "text-muted-foreground text-xs tabular-nums"
            }
          >
            {selection.charsUsed.toLocaleString()} of {SKILL_BUDGET_CHARS.toLocaleString()} characters used.
            {selection.dropped.length > 0
              ? " The budget fills in the order below, so a long skill above a short one can leave it nothing."
              : ""}
          </p>
        ) : null}
        {/* An attached ref with nothing behind it is shown here rather than
            dropped from the list, or the only way to detach a deleted or
            shadowed skill would be to know it was still there. */}
        {attachedElsewhere.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-amber-11 text-xs">
              Attached but not resolvable here. These are skipped on every turn and reported in the conversation's
              settings panel.
            </p>
            <ul className="flex flex-col gap-1">
              {attachedElsewhere.map((ref) => (
                <li key={`${ref.scope}:${ref.name}`} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {ref.name}
                    <span className="text-muted-foreground ms-1">{ref.scope}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Detach ${ref.name}`}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        attachedSkills: current.attachedSkills.filter(
                          (entry) => !(entry.name === ref.name && entry.scope === ref.scope),
                        ),
                        updatedAt: Date.now(),
                      }))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <Separator />

      <CompiledPromptDebug character={draft} persona={persona} skills={selection.injections} />

      <div className="flex items-center justify-between gap-2">
        {/* Exports the draft on screen, not the stored record: what the user is
            looking at is what they mean by "this character". */}
        <CharacterExport character={draft} />
        <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save character"}
        </Button>
        </div>
      </div>
    </form>
  );
}
