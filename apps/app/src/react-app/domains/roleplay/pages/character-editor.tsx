/** @jsxImportSource react */
import type {
  CharacterCardDataV2,
  RoleplayCharacterRecord,
  RoleplayPersona,
} from "@openwork/types/roleplay";
import { initialSceneState, normalizeHardLimits } from "@openwork/types/roleplay";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CharacterExport } from "../components/character-export";
import { CompiledPromptDebug } from "../components/compiled-prompt-debug";
import { ExampleDialogueEditor } from "../components/example-dialogue-editor";
import { HardLimitsEditor } from "../components/hard-limits-editor";
import { SceneRecordEditor } from "../components/scene-record-editor";

type CharacterEditorProps = {
  character: RoleplayCharacterRecord;
  persona: RoleplayPersona;
  saving: boolean;
  /**
   * Hides the adult half of the editor.
   *
   * It hides and never edits: a character already marked adult keeps the flag,
   * its records, and its preferred model while safe mode is on, and gets them
   * back untouched when it goes off. Saving through a hidden control is the one
   * thing this must not do.
   */
  safeMode: boolean;
  skills: OpenworkSkillItem[];
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
  safeMode,
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
  const attachedBodies = useAttachedSkillBodies(endpoint, attached);
  const selection = React.useMemo(
    () => selectSkillInjections(attachedBodies.skills),
    [attachedBodies.skills],
  );
  const injectedChars = new Map(selection.injections.map((entry) => [entry.name, entry.body.length]));
  const cutNames = new Set(selection.truncated);
  const droppedNames = new Set(selection.dropped);
  const unresolvedNames = new Set([...selection.unresolved, ...selection.shadowed]);
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

  const sceneTypeErrors = errors.filter((error) => error.field.startsWith("sceneRecords."));

  const submit = () => {
    const found = validateCharacter(draft);
    setErrors(found);
    if (found.length !== 0) return;
    const model = draft.preferredModel;
    const preferredModel = model && model.providerID.trim() && model.modelID.trim() ? model : undefined;
    onSave({
      ...draft,
      hardLimits: normalizeHardLimits(draft.hardLimits),
      ...(preferredModel ? { preferredModel } : { preferredModel: undefined }),
    });
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
                      unresolvedNames.has(skill.name) ? (
                        <span className="text-amber-11 ms-1 text-xs">
                          no such skill — nothing of this reaches the prompt
                        </span>
                      ) : droppedNames.has(skill.name) ? (
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

      <section className="flex flex-col gap-4">
        <HardLimitsEditor
          limits={draft.hardLimits}
          onChange={(hardLimits) => setDraft((current) => ({ ...current, hardLimits, updatedAt: Date.now() }))}
        />
      </section>

      <Separator />

      {/* The whole adult section, switch included, is hidden rather than
          disabled while safe mode is on. A disabled switch still says what the
          character is, which is the one thing safe mode exists to keep off the
          screen. Nothing here is cleared: turning safe mode off brings the
          section back exactly as it was. */}
      {safeMode ? null : (
      <>
      <section className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">Explicit scene</h3>
            <p className="text-muted-foreground text-sm">
              Lets this character track what the scene is doing — clothing, position, anything that changes — and
              update it as it writes.
            </p>
          </div>
          <Switch
            aria-label="Explicit scene"
            checked={draft.nsfw}
            onCheckedChange={(checked) =>
              setDraft((current) => ({ ...current, nsfw: checked === true, updatedAt: Date.now() }))
            }
          />
        </div>

        {draft.nsfw ? (
          <>
            <SceneRecordEditor
              records={draft.sceneRecords}
              onChange={(sceneRecords) => setDraft((current) => ({ ...current, sceneRecords, updatedAt: Date.now() }))}
            />
            {sceneTypeErrors.map((error) => (
              <FieldError key={error.field} message={error.message} />
            ))}
          </>
        ) : draft.sceneRecords.length > 0 ? (
          <p className="text-muted-foreground text-sm">
            {draft.sceneRecords.length} record{draft.sceneRecords.length === 1 ? "" : "s"} kept. Turn this back on to
            edit them.
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="rp-preferred-provider">Preferred model</Label>
              <p className="text-muted-foreground text-sm">
                Used when a conversation has not picked its own. Hosted providers refuse this kind of scene, so a
                character with nowhere to run reads as broken rather than as blocked.
              </p>
            </div>
            {draft.preferredModel ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setDraft((current) => {
                    const { preferredModel: _cleared, ...rest } = current;
                    return { ...rest, updatedAt: Date.now() };
                  })
                }
              >
                Clear
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Input
              id="rp-preferred-provider"
              placeholder="Provider id"
              value={draft.preferredModel?.providerID ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  preferredModel: {
                    providerID: event.target.value,
                    modelID: current.preferredModel?.modelID ?? "",
                  },
                  updatedAt: Date.now(),
                }))
              }
            />
            <Input
              aria-label="Model id"
              placeholder="Model id"
              value={draft.preferredModel?.modelID ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  preferredModel: {
                    providerID: current.preferredModel?.providerID ?? "",
                    modelID: event.target.value,
                  },
                  updatedAt: Date.now(),
                }))
              }
            />
          </div>
        </div>
      </section>

      <Separator />
      </>
      )}

      <CompiledPromptDebug
        character={draft}
        persona={persona}
        skills={selection.injections}
        sceneState={initialSceneState(draft.sceneRecords, draft.updatedAt)}
      />

      <div className="flex items-center justify-between gap-2">
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
