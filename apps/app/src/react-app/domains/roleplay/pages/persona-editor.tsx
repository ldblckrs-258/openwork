/** @jsxImportSource react */
import * as React from "react";
import type { RoleplayPersonaRecord } from "@openwork/types/roleplay";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type PersonaEditorProps = {
  persona: RoleplayPersonaRecord;
  saving: boolean;
  onSave: (persona: RoleplayPersonaRecord) => void;
};

/**
 * Who the user plays.
 *
 * The name here is what `{{user}}` resolves to in every card field, so an empty
 * one compiles the fallback word "User" into the character's own description.
 */
export function PersonaEditor({ persona, saving, onSave }: PersonaEditorProps) {
  const [draft, setDraft] = React.useState(persona);
  const [error, setError] = React.useState("");

  React.useEffect(() => setDraft(persona), [persona]);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.persona.name.trim()) {
          setError("Give your persona a name — the character uses it to address you.");
          return;
        }
        setError("");
        onSave({ ...draft, updatedAt: Date.now() });
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="persona-name">Your name</Label>
        <Input
          id="persona-name"
          value={draft.persona.name}
          placeholder="Wren"
          onChange={(event) => setDraft((current) => ({ ...current, persona: { ...current.persona, name: event.target.value } }))}
        />
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="persona-description">About you</Label>
        <Textarea
          id="persona-description"
          rows={4}
          value={draft.persona.description}
          placeholder="A courier with an overdue book."
          onChange={(event) =>
            setDraft((current) => ({ ...current, persona: { ...current.persona, description: event.target.value } }))
          }
        />
        <p className="text-muted-foreground text-sm">Included in the prompt so the character knows who they are talking to.</p>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save persona"}
        </Button>
      </div>
    </form>
  );
}
