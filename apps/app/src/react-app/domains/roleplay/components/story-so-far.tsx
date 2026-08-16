/** @jsxImportSource react */
import { Brain, LoaderCircle, Wand2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { STORY_SO_FAR_GUIDANCE } from "@/app/roleplay/compact-policy";

type StorySoFarProps = {
  value: string;
  saving: boolean;
  memoryBusy: boolean;
  revisionBusy: boolean;
  onSave: (value: string) => void;
  onExtractMemories: () => void;
  onProposeRevision: () => void;
};

export function StorySoFar({
  value,
  saving,
  memoryBusy,
  revisionBusy,
  onSave,
  onExtractMemories,
  onProposeRevision,
}: StorySoFarProps) {
  const [draft, setDraft] = React.useState(value);

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">{STORY_SO_FAR_GUIDANCE}</p>
      <Textarea rows={6} value={draft} onChange={(event) => setDraft(event.target.value)} />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={saving || draft === value} onClick={() => onSave(draft)}>
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={memoryBusy}
          onClick={onExtractMemories}
        >
          {memoryBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Brain className="size-4" />}
          Remember
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={revisionBusy}
          onClick={onProposeRevision}
        >
          {revisionBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
          Revise card
        </Button>
      </div>
    </div>
  );
}
