/** @jsxImportSource react */
import { MAX_HARD_LIMITS, MAX_HARD_LIMIT_CHARS } from "@openwork/types/roleplay";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type HardLimitsEditorProps = {
  limits: string[];
  onChange: (limits: string[]) => void;
};

/**
 * These entries are compiled into every prompt and are never dropped for budget.
 */
export function HardLimitsEditor({ limits, onChange }: HardLimitsEditorProps) {
  const rows = limits.length > 0 ? limits : [""];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label>Hard limits</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rows.length >= MAX_HARD_LIMITS}
          onClick={() => onChange([...rows, ""])}
        >
          <Plus className="size-4" />
          Add limit
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">
        Written into every prompt, above the character's own instruction, and never dropped to make room for anything
        else. Up to {MAX_HARD_LIMITS}.
      </p>
      {rows.map((limit, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={limit}
            maxLength={MAX_HARD_LIMIT_CHARS}
            placeholder="Never write…"
            onChange={(event) => {
              const next = [...rows];
              next[index] = event.target.value;
              onChange(next);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove limit ${index + 1}`}
            disabled={rows.length === 1 && !rows[0]}
            onClick={() => onChange(rows.filter((_unused, position) => position !== index))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
