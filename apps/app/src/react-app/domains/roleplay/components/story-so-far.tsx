/** @jsxImportSource react */
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { STORY_SO_FAR_GUIDANCE } from "@/app/roleplay/compact-policy";

type StorySoFarProps = {
  value: string;
  saving: boolean;
  /** Set once the conversation has been compacted, so the notice explains why this matters now. */
  compacted: boolean;
  memoryBusy: boolean;
  revisionBusy: boolean;
  onSave: (value: string) => void;
  onExtractMemories: () => void;
  onProposeRevision: () => void;
};

export function StorySoFar({
  value,
  saving,
  compacted,
  memoryBusy,
  revisionBusy,
  onSave,
  onExtractMemories,
  onProposeRevision,
}: StorySoFarProps) {
  const [draft, setDraft] = React.useState(value);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 pb-2">
        {compacted ? (
          <p className="text-muted-foreground text-xs">
            This conversation was compacted. Anything the summary dropped survives only in the story so far.
          </p>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1">
          {/* Deliberately a button rather than something that fires on its own:
              extraction is an extra completion over the whole transcript. */}
          <Button type="button" variant="ghost" size="sm" disabled={memoryBusy} onClick={onExtractMemories}>
            {memoryBusy ? "Thinking…" : "Remember this"}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={revisionBusy} onClick={onProposeRevision}>
            {revisionBusy ? "Reading back…" : "Suggest card edits"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
            Story so far
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-4 pb-2">
      <div>
        <h3 className="text-sm font-medium">Story so far</h3>
        <p className="text-muted-foreground text-xs">{STORY_SO_FAR_GUIDANCE}</p>
      </div>
      <Textarea rows={6} value={draft} onChange={(event) => setDraft(event.target.value)} />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={saving} onClick={() => onSave(draft)}>
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setDraft(value);
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
