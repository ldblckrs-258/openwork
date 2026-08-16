/** @jsxImportSource react */
import { Check, X } from "lucide-react";
import * as React from "react";

import type { MemoryProposal } from "@/app/roleplay/memory-extract";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type MemoryReviewProps = {
  open: boolean;
  proposals: MemoryProposal[];
  saving: boolean;
  onKeep: (texts: string[]) => void;
  onClose: () => void;
};

export function MemoryReview({ open, proposals, saving, onKeep, onClose }: MemoryReviewProps) {
  const [texts, setTexts] = React.useState<string[]>([]);
  const [keeping, setKeeping] = React.useState<boolean[]>([]);

  React.useEffect(() => {
    setTexts(proposals.map((proposal) => proposal.text));
    setKeeping(proposals.map(() => false));
  }, [proposals]);

  const keptCount = keeping.filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>What should the character remember?</DialogTitle>
          <DialogDescription>
            Nothing is saved unless you keep it. Edit the wording — it is what the character will read.
          </DialogDescription>
        </DialogHeader>

        {proposals.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing new came out of this conversation that the character does not already know.
          </p>
        ) : (
          <ul className="flex max-h-96 flex-col gap-3 overflow-y-auto">
            {proposals.map((proposal, index) => (
              <li key={`${proposal.text}-${index}`} className="flex items-start gap-2">
                <Textarea
                  rows={2}
                  value={texts[index] ?? ""}
                  aria-label={`Proposed memory ${index + 1}`}
                  onChange={(event) =>
                    setTexts((current) => current.map((text, slot) => (slot === index ? event.target.value : text)))
                  }
                />
                <Button
                  type="button"
                  variant={keeping[index] ? "default" : "outline"}
                  size="icon"
                  aria-label={keeping[index] ? `Keeping proposal ${index + 1}` : `Keep proposal ${index + 1}`}
                  onClick={() =>
                    setKeeping((current) => current.map((kept, slot) => (slot === index ? !kept : kept)))
                  }
                >
                  <Check className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            <X className="size-4" />
            Discard all
          </Button>
          <Button
            type="button"
            disabled={keptCount === 0 || saving}
            onClick={() => onKeep(texts.filter((_, index) => keeping[index]))}
          >
            {saving ? "Saving…" : `Remember ${keptCount || ""}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
