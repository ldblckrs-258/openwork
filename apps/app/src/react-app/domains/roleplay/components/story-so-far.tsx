/** @jsxImportSource react */
import { Brain, LoaderCircle, ScrollText, Wand2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { MessageAction } from "@/components/ui/message";
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

/**
 * The session-level roleplay actions, and the continuity notes behind one of them.
 *
 * Icon-only with tooltips, matching the message action bar: these sit above the
 * composer on every roleplay turn, and three labelled buttons there read as a
 * second toolbar competing with the one under each reply.
 *
 * Both model-calling actions are buttons rather than anything automatic. Each
 * costs a completion over the whole transcript, and running them unasked spends
 * the user's money on a review dialog they may not want.
 */
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
      <div className="text-muted-foreground flex items-center justify-between gap-3 px-4 pb-1">
        {compacted ? (
          <p className="text-xs">
            This conversation was compacted. Anything the summary dropped survives only in the story so far.
          </p>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-0">
          <MessageAction tooltip={memoryBusy ? "Working out what to remember…" : "Remember this conversation"}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remember this conversation"
              disabled={memoryBusy}
              onClick={onExtractMemories}
            >
              {memoryBusy ? <LoaderCircle className="animate-spin" /> : <Brain />}
            </Button>
          </MessageAction>
          <MessageAction tooltip={revisionBusy ? "Reading the conversation back…" : "Suggest edits to the card"}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Suggest edits to the card"
              disabled={revisionBusy}
              onClick={onProposeRevision}
            >
              {revisionBusy ? <LoaderCircle className="animate-spin" /> : <Wand2 />}
            </Button>
          </MessageAction>
          <MessageAction tooltip="Story so far">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Story so far"
              onClick={() => setOpen(true)}
            >
              <ScrollText />
            </Button>
          </MessageAction>
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
