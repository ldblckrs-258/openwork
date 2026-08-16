/** @jsxImportSource react */
import type {
  RoleplayLorebookRecord,
  RoleplayPersonaRecord,
  RoleplaySessionSettings,
} from "@openwork/types/roleplay";
import * as React from "react";

import type { LorebookSelection, LorebookTraceLine } from "@/app/roleplay/lorebook";
import { LOREBOOK_BUDGET_CHARS } from "@/app/roleplay/lorebook";
import { MEMORY_BUDGET_CHARS } from "@/app/roleplay/memory";
import { COMBINED_SYSTEM_BUDGET_CHARS } from "@/app/roleplay/compose-system";
import {
  MAX_SESSION_SYSTEM_PROMPT_CHARS,
  MAX_SOURCE_BUDGET_CHARS,
  budgetsCrowdOutCharacter,
  resolveSessionSettings,
  totalSourceBudgetChars,
} from "@/app/roleplay/session-settings";
import { DEFAULT_SAFEWORD, MAX_SAFEWORD_CHARS, SCENE_INTENSITY_LEVELS } from "@openwork/types/roleplay";
import { SKILL_BUDGET_CHARS, type RoleplayAttachedSkill, type SkillSelection } from "@/app/roleplay/skills-injection";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { StorySoFar } from "./story-so-far";

export type RoleplayTurnDiagnostics = {
  lorebook: LorebookSelection;
  skills: SkillSelection;
  systemChars: number;
  truncated: boolean;
  sceneStateChars: number;
  sceneRecordCount: number;
};

const SCENE_INTENSITY_LABELS: Record<string, { label: string; hint: string }> = {
  fade_to_black: { label: "Fade to black", hint: "Cuts away before anything explicit." },
  suggestive: { label: "Suggestive", hint: "Written, but the explicit detail is left implied." },
  explicit: { label: "Explicit", hint: "Written directly, in plain language." },
  graphic: { label: "Graphic", hint: "Written directly and in full physical detail." },
};

type SessionSettingsPanelProps = {
  characterName: string;
  nsfw: boolean;
  personas: RoleplayPersonaRecord[];
  personaId: string;
  onSelectPersona: (personaId: string) => void;
  lorebooks: RoleplayLorebookRecord[];
  skills: RoleplayAttachedSkill[];
  settings: RoleplaySessionSettings;
  onChangeSettings: (settings: RoleplaySessionSettings) => void;
  saving: boolean;
  diagnostics: RoleplayTurnDiagnostics | null;
  storySoFar: string;
  memoryBusy: boolean;
  revisionBusy: boolean;
  onSaveStorySoFar: (value: string) => void;
  onExtractMemories: () => void;
  onProposeRevision: () => void;
};

const REASON_LABEL: Record<LorebookTraceLine["reason"], string> = {
  constant: "always on",
  key: "keyword",
  recursive: "triggered by another entry",
  disabled: "switched off",
  empty: "no content",
  no_key_match: "no keyword in range",
  selective_unmet: "second keyword missing",
  book_budget: "over the book's own budget",
  budget: "over the budget",
};

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 px-4 py-3">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function BudgetField({
  id,
  label,
  value,
  fallback,
  onCommit,
}: {
  id: string;
  label: string;
  value: number | undefined;
  fallback: number;
  onCommit: (value: number | undefined) => void;
}) {
  const [draft, setDraft] = React.useState(value === undefined ? "" : String(value));

  React.useEffect(() => {
    setDraft(value === undefined ? "" : String(value));
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      onCommit(undefined);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(value === undefined ? "" : String(value));
      return;
    }
    onCommit(Math.min(MAX_SOURCE_BUDGET_CHARS, Math.max(0, Math.round(parsed))));
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
      <Input
        id={id}
        inputMode="numeric"
        className="h-8 w-28 text-right tabular-nums"
        placeholder={`${fallback}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </div>
  );
}

/**
 * A cleared field commits as empty and resolves back to the app's default
 * rather than to no safeword at all. A session with no safeword is the
 * one state this control must not be able to reach.
 */
function SafewordField({
  value,
  saving,
  onCommit,
}: {
  value: string | undefined;
  saving: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = React.useState(value ?? "");

  React.useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim().slice(0, MAX_SAFEWORD_CHARS);
    if (trimmed !== (value ?? "")) onCommit(trimmed);
    setDraft(trimmed);
  };

  const ordinary = /^[\p{L}\p{N}]+$/u.test(draft.trim());

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="rp-safeword" className="text-sm font-normal">
          Safeword
        </Label>
        <Input
          id="rp-safeword"
          className="h-8 w-40"
          maxLength={MAX_SAFEWORD_CHARS}
          placeholder={DEFAULT_SAFEWORD}
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </div>
      {/* Said where the choice is made, not discovered later. A plain word is a
          legitimate choice — it is the one people actually remember — but it
          will also stop the scene when it turns up in ordinary prose. */}
      {ordinary ? (
        <p className="text-muted-foreground text-xs">
          An ordinary word also stops the scene when you write it in the story itself.
        </p>
      ) : null}
    </div>
  );
}

function TraceRows({ lines, included }: { lines: LorebookTraceLine[]; included: boolean }) {
  const rows = lines.filter((line) => line.included === included);
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-muted-foreground text-xs font-medium">
        {included ? `In the prompt (${rows.length})` : `Left out (${rows.length})`}
      </p>
      <ul className="flex flex-col gap-1">
        {rows.map((line) => (
          <li key={`${line.bookId}:${line.uid}`} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate" title={`${line.bookName} · ${line.label}`}>
              {line.label}
            </span>
            <span className="text-muted-foreground shrink-0">
              {REASON_LABEL[line.reason]}
              {line.matchedKey ? ` · ${line.matchedKey}` : ""}
            </span>
            <span className="text-muted-foreground shrink-0 tabular-nums">{line.chars}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SkillRows({ selection }: { selection: SkillSelection }) {
  const cut = new Set(selection.truncated);
  const rows: { name: string; reason: string }[] = [
    ...selection.injections.map((entry) => ({
      name: entry.name,
      reason: cut.has(entry.name) ? "in the prompt, cut to fit" : "in the prompt",
    })),
    ...selection.dropped.map((name) => ({ name, reason: "over the guidance budget" })),
    ...selection.unresolved.map((name) => ({ name, reason: "no such skill" })),
    ...selection.shadowed.map((name) => ({ name, reason: "another skill has taken this name" })),
  ];
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-muted-foreground text-xs font-medium">Writing guidance ({selection.charsUsed} characters)</p>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={`${row.reason}:${row.name}`} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            <span className="text-muted-foreground shrink-0">{row.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SessionSettingsPanel(props: SessionSettingsPanelProps) {
  const resolved = resolveSessionSettings(props.settings);
  const patch = (next: Partial<RoleplaySessionSettings>) => {
    props.onChangeSettings({ ...props.settings, ...next });
  };

  const disabled = new Set(resolved.disabledLorebookIds);
  const disabledSkills = new Set(resolved.disabledSkillNames);
  const [promptDraft, setPromptDraft] = React.useState(resolved.systemPrompt);
  React.useEffect(() => {
    setPromptDraft(resolved.systemPrompt);
  }, [resolved.systemPrompt]);

  const budgetTotal = totalSourceBudgetChars(resolved);
  const crowdsOut = budgetsCrowdOutCharacter(resolved);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <Section
        title="Persona"
        hint={`Who ${props.characterName || "the character"} is talking to. Changing it takes effect on the next reply.`}
      >
        <Select
          value={props.personaId}
          onValueChange={(value) => {
            if (typeof value === "string" && value) props.onSelectPersona(value);
          }}
          disabled={props.saving || props.personas.length === 0}
        >
          <SelectTrigger className="w-full" aria-label="Persona">
            <SelectValue placeholder="No persona" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {props.personas.map((record) => (
                <SelectItem key={record.id} value={record.id}>
                  {record.persona.name || "Unnamed persona"}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Section>

      <Separator />

      <Section title="Story so far">
        <StorySoFar
          value={props.storySoFar}
          saving={props.saving}
          memoryBusy={props.memoryBusy}
          revisionBusy={props.revisionBusy}
          onSave={props.onSaveStorySoFar}
          onExtractMemories={props.onExtractMemories}
          onProposeRevision={props.onProposeRevision}
        />
      </Section>

      <Separator />

      <Section
        title="Lorebooks"
        hint={
          props.lorebooks.length === 0
            ? "No lorebook is attached to this character."
            : "Switching one off here leaves it attached to the character; only this conversation stops scanning it."
        }
      >
        {props.lorebooks.map((book) => (
          <div key={book.id} className="flex items-center justify-between gap-3">
            <Label htmlFor={`lorebook-${book.id}`} className="min-w-0 flex-1 truncate text-sm font-normal">
              {book.name || "Untitled lorebook"}
              <span className="text-muted-foreground ms-1 tabular-nums">({book.entries.length})</span>
            </Label>
            <Switch
              id={`lorebook-${book.id}`}
              checked={!disabled.has(book.id)}
              onCheckedChange={(checked) =>
                patch({
                  disabledLorebookIds: checked
                    ? resolved.disabledLorebookIds.filter((id) => id !== book.id)
                    : [...resolved.disabledLorebookIds, book.id],
                })
              }
            />
          </div>
        ))}
        {props.lorebooks.length > 0 ? (
          <BudgetField
            id="rp-scan-depth"
            label="Messages scanned"
            value={props.settings.scanDepth}
            fallback={4}
            onCommit={(value) => patch({ scanDepth: value === undefined ? undefined : Math.max(1, value) })}
          />
        ) : null}
      </Section>

      <Separator />

      <Section
        title="Writing guidance"
        hint={
          props.skills.length === 0
            ? "No skill is attached to this character."
            : "Attached skills are injected as writing guidance. Switching one off here leaves it attached to the character."
        }
      >
        {props.skills.map((skill) => (
          <div key={skill.name} className="flex items-center justify-between gap-3">
            <Label htmlFor={`skill-${skill.name}`} className="min-w-0 flex-1 truncate text-sm font-normal">
              {skill.name}
              <span className="text-muted-foreground ms-1">{skill.scope}</span>
            </Label>
            <Switch
              id={`skill-${skill.name}`}
              disabled={Boolean(skill.status)}
              checked={!skill.status && !disabledSkills.has(skill.name)}
              onCheckedChange={(checked) =>
                patch({
                  disabledSkillNames: checked
                    ? resolved.disabledSkillNames.filter((name) => name !== skill.name)
                    : [...resolved.disabledSkillNames, skill.name],
                })
              }
            />
          </div>
        ))}
      </Section>

      <Separator />

      <Section
        title="Prompt budget"
        hint="Characters each source may occupy. Leave blank for the default. The two no longer compete: each is cut to its own number."
      >
        <BudgetField
          id="rp-memory-budget"
          label="Memories"
          value={props.settings.memoryBudgetChars}
          fallback={MEMORY_BUDGET_CHARS}
          onCommit={(value) => patch({ memoryBudgetChars: value })}
        />
        <BudgetField
          id="rp-lorebook-budget"
          label="Lorebook"
          value={props.settings.lorebookBudgetChars}
          fallback={LOREBOOK_BUDGET_CHARS}
          onCommit={(value) => patch({ lorebookBudgetChars: value })}
        />
        <p className="text-muted-foreground text-xs tabular-nums">
          {budgetTotal} of {COMBINED_SYSTEM_BUDGET_CHARS} characters claimed before the character itself, including{" "}
          {SKILL_BUDGET_CHARS} for writing guidance.
        </p>
        {crowdsOut ? (
          <p className="text-amber-11 text-xs">
            These budgets claim more than half the system prompt. The character's own description is what gets cut
            first.
          </p>
        ) : null}
      </Section>

      <Separator />

      <Section
        title="System prompt"
        hint="Replaces the card's own instruction for this conversation. Blank leaves the card's, and the app's, in place. {{original}} expands to the app's."
      >
        <Textarea
          rows={4}
          maxLength={MAX_SESSION_SYSTEM_PROMPT_CHARS}
          value={promptDraft}
          placeholder="Leave blank to use the card's"
          onChange={(event) => setPromptDraft(event.target.value)}
          onBlur={() => {
            if (promptDraft !== resolved.systemPrompt) patch({ systemPrompt: promptDraft });
          }}
        />
      </Section>

      <Separator />

      <Section
        title="Safety"
        hint="The safeword stops the scene for this conversation. It is matched anywhere in a message, including mid-sentence and inside an aside."
      >
        {resolved.deEscalated ? (
          <div className="border-amber-6 bg-amber-2 flex flex-col gap-2 rounded-md border p-3">
            <p className="text-amber-11 text-xs">
              The scene is paused. Replies stay out of character and nothing can change the scene until you start it
              again.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="self-start"
              disabled={props.saving}
              // The only way back. Deliberately not a phrase the model can
              // produce, and deliberately not cleared by the next send: a model
              // that ignored the de-escalation instruction would otherwise
              // resume the scene one turn after the user stopped it.
              onClick={() => patch({ deEscalated: false })}
            >
              Start the scene again
            </Button>
          </div>
        ) : null}
        <SafewordField
          value={props.settings.safeword}
          saving={props.saving}
          onCommit={(value) => patch({ safeword: value })}
        />
        {props.nsfw ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="rp-intensity" className="text-sm font-normal">
              How far scenes go
            </Label>
            <Select
              value={String(resolved.intensity)}
              onValueChange={(value) => {
                const level = Number(value);
                if (Number.isFinite(level)) patch({ intensity: level });
              }}
              disabled={props.saving}
            >
              <SelectTrigger id="rp-intensity" className="w-full" aria-label="How far scenes go">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {SCENE_INTENSITY_LEVELS.map((level, index) => (
                    <SelectItem key={level} value={String(index)}>
                      {SCENE_INTENSITY_LABELS[level]?.label ?? level}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {SCENE_INTENSITY_LABELS[SCENE_INTENSITY_LEVELS[resolved.intensity] ?? ""]?.hint ?? ""}
            </p>
          </div>
        ) : null}
      </Section>

      <Separator />

      <Section title="Transcript">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="rp-color-segments" className="text-sm font-normal">
            Colour speech, actions, and asides
          </Label>
          <Switch
            id="rp-color-segments"
            checked={resolved.colorSegments}
            onCheckedChange={(checked) => patch({ colorSegments: checked })}
          />
        </div>
      </Section>

      {props.diagnostics ? (
        <>
          <Separator />
          <Section
            title="Last reply"
            hint="What the most recent send put in the prompt. A lorebook entry that did not fire says which check it failed."
          >
            <p className="text-muted-foreground text-xs tabular-nums">
              System prompt {props.diagnostics.systemChars} characters
              {props.diagnostics.truncated ? " · truncated to fit" : ""}
            </p>
            {props.diagnostics.truncated ? (
              <p className="text-amber-11 text-xs">
                The composed prompt was cut. Lower a budget, or shorten the card, or the character loses the end of
                its own description.
              </p>
            ) : null}
            <SkillRows selection={props.diagnostics.skills} />
            <TraceRows lines={props.diagnostics.lorebook.trace} included />
            <TraceRows lines={props.diagnostics.lorebook.trace} included={false} />
          </Section>
        </>
      ) : null}

      <div className="px-4 pt-1 pb-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={props.saving}
          onClick={() =>
            props.onChangeSettings({
              disabledLorebookIds: [],
              disabledSkillNames: [],
              systemPrompt: "",
              // Carried through the reset. A paused scene is not a setting the
              // user has drifted away from — it is a thing they asked for, and
              // "reset to defaults" is not the sentence that undoes it.
              ...(resolved.deEscalated ? { deEscalated: true } : {}),
            })
          }
        >
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
