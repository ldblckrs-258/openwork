/** @jsxImportSource react */
import { Check } from "lucide-react";
import * as React from "react";

import type { FieldProposal, RevisableField } from "@/app/roleplay/revise";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const FIELD_LABELS: Record<RevisableField, string> = {
  description: "Description",
  personality: "Personality",
  scenario: "Scenario",
  mes_example: "Example dialogue",
};

type CardDiffProps = {
  open: boolean;
  proposals: FieldProposal[];
  saving: boolean;
  onApply: (fields: RevisableField[]) => void;
  onClose: () => void;
};

export function CardDiff({ open, proposals, saving, onApply, onClose }: CardDiffProps) {
  const [approved, setApproved] = React.useState<RevisableField[]>([]);

  React.useEffect(() => setApproved([]), [proposals]);

  const toggle = (field: RevisableField) =>
    setApproved((current) =>
      current.includes(field) ? current.filter((entry) => entry !== field) : [...current, field],
    );

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Proposed changes to the card</DialogTitle>
          <DialogDescription>
            Approve field by field. Anything you leave unchecked is discarded, and the card stays exactly as it is.
          </DialogDescription>
        </DialogHeader>

        {proposals.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing in this conversation calls for a change to the card.
          </p>
        ) : (
          <ul className="flex max-h-[28rem] flex-col gap-5 overflow-y-auto">
            {proposals.map((proposal) => (
              <li key={proposal.field} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-medium">{FIELD_LABELS[proposal.field]}</h4>
                  <Button
                    type="button"
                    variant={approved.includes(proposal.field) ? "default" : "outline"}
                    size="sm"
                    aria-label={
                      approved.includes(proposal.field)
                        ? `Keeping the change to ${FIELD_LABELS[proposal.field]}`
                        : `Approve the change to ${FIELD_LABELS[proposal.field]}`
                    }
                    onClick={() => toggle(proposal.field)}
                  >
                    <Check className="size-4" />
                    {approved.includes(proposal.field) ? "Approved" : "Approve"}
                  </Button>
                </div>
                {proposal.why ? <p className="text-muted-foreground text-sm">{proposal.why}</p> : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="border-border rounded-md border p-2">
                    <p className="text-muted-foreground text-xs">Now</p>
                    <p className="whitespace-pre-wrap text-sm">{proposal.before || "(empty)"}</p>
                  </div>
                  <div className="border-border rounded-md border p-2">
                    <p className="text-muted-foreground text-xs">Proposed</p>
                    <p className="whitespace-pre-wrap text-sm">{proposal.after}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Discard all
          </Button>
          <Button type="button" disabled={approved.length === 0 || saving} onClick={() => onApply(approved)}>
            {saving ? "Applying…" : `Apply ${approved.length || ""}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
