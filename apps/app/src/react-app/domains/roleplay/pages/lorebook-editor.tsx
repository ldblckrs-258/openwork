/** @jsxImportSource react */
import type {
  RoleplayCharacterRecord,
  RoleplayLorebookEntry,
  RoleplayLorebookRecord,
} from "@openwork/types/roleplay";
import { Plus, Trash2 } from "lucide-react";
import * as React from "react";

import {
  createBlankLorebookEntry,
  createLorebookEntryUid,
  selectLorebookEntries,
} from "@/app/roleplay/lorebook";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

type LorebookEditorProps = {
  lorebook: RoleplayLorebookRecord;
  characters: RoleplayCharacterRecord[];
  saving: boolean;
  onSave: (lorebook: RoleplayLorebookRecord) => void;
  onCancel: () => void;
};

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function keyList(keys: string[]): string {
  return keys.join(", ");
}

function parseKeys(value: string): string[] {
  return value.split(",").map((key) => key.trim()).filter(Boolean);
}

function entryLabel(entry: RoleplayLorebookEntry): string {
  return entry.name?.trim() || entry.comment?.trim() || entry.keys[0] || "Untitled entry";
}

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number(value);
  return value.trim() === "" || Number.isNaN(parsed) ? undefined : parsed;
}

export function LorebookEditor({ lorebook, characters, saving, onSave, onCancel }: LorebookEditorProps) {
  const [draft, setDraft] = React.useState(lorebook);
  const [selectedUid, setSelectedUid] = React.useState<string | null>(lorebook.entries[0]?.uid ?? null);
  const [probe, setProbe] = React.useState("");

  React.useEffect(() => {
    setDraft(lorebook);
    setSelectedUid(lorebook.entries[0]?.uid ?? null);
  }, [lorebook]);

  const selected = draft.entries.find((entry) => entry.uid === selectedUid) ?? null;

  const editEntry = (uid: string, change: Partial<RoleplayLorebookEntry>) => {
    setDraft((current) => ({
      ...current,
      entries: current.entries.map((entry) => (entry.uid === uid ? { ...entry, ...change } : entry)),
    }));
  };

  const addEntry = () => {
    const uid = createLorebookEntryUid(Date.now(), randomSuffix());
    setDraft((current) => ({
      ...current,
      entries: [...current.entries, createBlankLorebookEntry(uid, current.entries.length * 10)],
    }));
    setSelectedUid(uid);
  };

  const removeEntry = (uid: string) => {
    setDraft((current) => {
      const entries = current.entries.filter((entry) => entry.uid !== uid);
      return { ...current, entries };
    });
    setSelectedUid((current) => (current === uid ? null : current));
  };

  const toggleCharacter = (characterId: string) => {
    setDraft((current) => ({
      ...current,
      characterIds: current.characterIds.includes(characterId)
        ? current.characterIds.filter((id) => id !== characterId)
        : [...current.characterIds, characterId],
    }));
  };

  const preview = React.useMemo(
    () => selectLorebookEntries([draft], probe.trim() ? [{ role: "user", text: probe }] : []),
    [draft, probe],
  );

  return (
    <form
      className="mx-auto flex max-w-3xl flex-col gap-6 px-10 py-6"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ ...draft, updatedAt: Date.now() });
      }}
    >
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="lorebook-name">Name</Label>
          <Input
            id="lorebook-name"
            value={draft.name}
            placeholder="Ashfell"
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="lorebook-description">Description</Label>
          <Textarea
            id="lorebook-description"
            rows={2}
            value={draft.description}
            placeholder="What this world covers. Not sent to the model."
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
          />
        </div>

        <div className="flex items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="lorebook-scan-depth">Scan depth</Label>
            <Input
              id="lorebook-scan-depth"
              type="number"
              min={1}
              className="w-32"
              value={draft.scanDepth ?? ""}
              placeholder="4"
              onChange={(event) =>
                setDraft((current) => ({ ...current, scanDepth: numberOrUndefined(event.target.value) }))
              }
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="lorebook-token-budget">Token budget</Label>
            <Input
              id="lorebook-token-budget"
              type="number"
              min={0}
              className="w-32"
              value={draft.tokenBudget ?? ""}
              placeholder="app default"
              onChange={(event) =>
                setDraft((current) => ({ ...current, tokenBudget: numberOrUndefined(event.target.value) }))
              }
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox
              checked={draft.recursiveScanning === true}
              onCheckedChange={(checked) =>
                setDraft((current) => ({ ...current, recursiveScanning: checked === true }))
              }
            />
            Entries can trigger other entries
          </label>
        </div>
        <p className="text-muted-foreground text-sm">
          Scan depth is how many recent messages keys are matched against. The token budget only ever lowers this
          book's share of the prompt. It cannot raise it.
        </p>
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Attached characters</h3>
            <p className="text-muted-foreground text-sm">
              A lorebook attached to nothing is never injected.
            </p>
          </div>
        </div>
        {characters.length === 0 ? (
          <p className="text-muted-foreground text-sm">No characters yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {characters.map((character) => (
              <li key={character.id}>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.characterIds.includes(character.id)}
                    onCheckedChange={() => toggleCharacter(character.id)}
                  />
                  {character.card.data.name || "Untitled character"}
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Entries</h3>
            <p className="text-muted-foreground text-sm">
              {draft.entries.length} {draft.entries.length === 1 ? "entry" : "entries"}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addEntry}>
            <Plus className="size-4" />
            Add entry
          </Button>
        </div>

        <ul className="border-border max-h-64 overflow-y-auto rounded-md border">
          {draft.entries.map((entry) => (
            <li key={entry.uid} className="flex items-center gap-2 border-b last:border-b-0">
              <button
                type="button"
                className={`flex-1 px-3 py-2 text-left text-sm ${entry.uid === selectedUid ? "bg-accent" : ""}`}
                onClick={() => setSelectedUid(entry.uid)}
              >
                <span className={entry.enabled === false ? "text-muted-foreground line-through" : ""}>
                  {entryLabel(entry)}
                </span>
                {entry.constant ? <span className="text-muted-foreground"> · always on</span> : null}
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Delete ${entryLabel(entry)}`}
                onClick={() => removeEntry(entry.uid)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>

        {selected ? (
          <div className="border-border flex flex-col gap-4 rounded-md border p-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="entry-name">Label</Label>
              <Input
                id="entry-name"
                value={selected.name ?? ""}
                placeholder="The harbour"
                onChange={(event) => editEntry(selected.uid, { name: event.target.value })}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="entry-keys">Keys</Label>
              <Input
                id="entry-keys"
                value={keyList(selected.keys)}
                placeholder="harbour, docks"
                onChange={(event) => editEntry(selected.uid, { keys: parseKeys(event.target.value) })}
              />
              <p className="text-muted-foreground text-sm">
                Comma separated. The entry fires when any of them appears in the recent conversation.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="entry-content">Content</Label>
              <Textarea
                id="entry-content"
                rows={4}
                value={selected.content}
                placeholder="The harbour freezes over every winter."
                onChange={(event) => editEntry(selected.uid, { content: event.target.value })}
              />
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={selected.enabled !== false}
                  onCheckedChange={(checked) => editEntry(selected.uid, { enabled: checked === true })}
                />
                Enabled
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={selected.constant === true}
                  onCheckedChange={(checked) => editEntry(selected.uid, { constant: checked === true })}
                />
                Always on
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={selected.case_sensitive === true}
                  onCheckedChange={(checked) => editEntry(selected.uid, { case_sensitive: checked === true })}
                />
                Case sensitive
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={selected.use_regex === true}
                  onCheckedChange={(checked) => editEntry(selected.uid, { use_regex: checked === true })}
                />
                Keys are patterns
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={selected.position === "before_char"}
                  onCheckedChange={(checked) =>
                    editEntry(selected.uid, { position: checked === true ? "before_char" : "after_char" })
                  }
                />
                Place before the character
              </label>
            </div>

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selected.selective === true}
                  onCheckedChange={(checked) => editEntry(selected.uid, { selective: checked === true })}
                />
                Also require a second key
              </label>
              {selected.selective ? (
                <Input
                  value={keyList(selected.secondary_keys ?? [])}
                  placeholder="storm, fog"
                  onChange={(event) => editEntry(selected.uid, { secondary_keys: parseKeys(event.target.value) })}
                />
              ) : null}
            </div>

            <div className="flex items-end gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="entry-order">Order</Label>
                <Input
                  id="entry-order"
                  type="number"
                  className="w-32"
                  value={selected.insertion_order}
                  onChange={(event) =>
                    editEntry(selected.uid, { insertion_order: Number(event.target.value) || 0 })
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="entry-priority">Priority</Label>
                <Input
                  id="entry-priority"
                  type="number"
                  className="w-32"
                  value={selected.priority ?? ""}
                  placeholder="0"
                  onChange={(event) =>
                    editEntry(selected.uid, { priority: numberOrUndefined(event.target.value) })
                  }
                />
              </div>
            </div>
            <p className="text-muted-foreground text-sm">
              Lower order sits earlier in the prompt. When the budget is full, the lowest priority is dropped first.
            </p>
          </div>
        ) : null}
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-medium">What would fire</h3>
          <p className="text-muted-foreground text-sm">
            Type a line as if it were the last message, and see which entries this book would inject.
          </p>
        </div>
        <Textarea
          rows={2}
          value={probe}
          placeholder="I walked down to the harbour."
          onChange={(event) => setProbe(event.target.value)}
        />
        <ul className="flex flex-col gap-1 text-sm">
          {preview.trace.map((line) => (
            <li key={line.uid} className="flex items-center justify-between gap-3">
              <span className={line.included ? "" : "text-muted-foreground"}>{line.label}</span>
              <span className="text-muted-foreground">
                {line.included
                  ? line.reason === "constant"
                    ? "always on"
                    : line.reason === "recursive"
                      ? `triggered by "${line.matchedKey}" in another entry`
                      : `matched "${line.matchedKey}"`
                  : line.reason === "disabled"
                    ? "disabled"
                    : line.reason === "empty"
                      ? "no content"
                      : line.reason === "selective_unmet"
                        ? "second key not found"
                        : line.reason === "budget" || line.reason === "book_budget"
                          ? "dropped, budget full"
                          : "no key matched"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save lorebook"}
        </Button>
      </div>
    </form>
  );
}
