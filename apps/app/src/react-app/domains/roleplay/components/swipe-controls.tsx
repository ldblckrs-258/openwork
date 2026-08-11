/** @jsxImportSource react */
import { ChevronLeft, ChevronRight, GitBranch, RefreshCw } from "lucide-react";
import type { RoleplayTurnRecord } from "@openwork/types/roleplay";

import { Button } from "@/components/ui/button";

type SwipeControlsProps = {
  turn: RoleplayTurnRecord | null;
  busy: boolean;
  onSwipe: () => void;
  onSelectAlternative: (offset: number) => void;
  onBranch: () => void;
};

export function SwipeControls({ turn, busy, onSwipe, onSelectAlternative, onBranch }: SwipeControlsProps) {
  if (!turn) return null;

  const total = turn.alternatives.length;
  // The live reply sits one past the captured ones, so the count the user sees
  // includes it even before it has been archived by the next regenerate.
  const shown = Math.min(turn.activeAlternative + 1, Math.max(total, 1));
  const canGoBack = turn.activeAlternative > 0;
  const canGoForward = turn.activeAlternative < total - 1;

  return (
    <div className="flex items-center gap-1 px-4 pb-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Previous reply"
        disabled={busy || !canGoBack}
        onClick={() => onSelectAlternative(-1)}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <span className="text-muted-foreground text-xs tabular-nums">
        {shown} / {Math.max(total, 1)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Next reply"
        disabled={busy || !canGoForward}
        onClick={() => onSelectAlternative(1)}
      >
        <ChevronRight className="size-4" />
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onSwipe}>
        <RefreshCw className="size-4" />
        Regenerate
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onBranch}>
        <GitBranch className="size-4" />
        Branch
      </Button>
    </div>
  );
}
