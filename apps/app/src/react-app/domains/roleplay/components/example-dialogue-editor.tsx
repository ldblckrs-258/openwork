/** @jsxImportSource react */
import { Plus, Trash2 } from "lucide-react";
import * as React from "react";

import {
  joinExampleMessages,
  splitExampleMessages,
} from "@/app/roleplay/macros";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ExampleDialogueEditorProps = {
  value: string;
  onChange: (mesExample: string) => void;
};

/**
 * Example dialogue is a sequence of exchanges, not free text.
 *
 * A single textarea makes the user type `<START>` separators by hand, and a
 * malformed one fails silently — the model simply sees one run-on exchange
 * instead of several examples. Editing blocks and writing the separators here
 * removes the failure mode rather than validating it after the fact.
 */
export function ExampleDialogueEditor({
  value,
  onChange,
}: ExampleDialogueEditorProps) {
  const blocks = React.useMemo(() => splitExampleMessages(value), [value]);
  const items = blocks.length > 0 ? blocks : [""];

  const commit = (next: string[]) => onChange(joinExampleMessages(next));

  return (
    <div className="flex flex-col gap-3 ">
      <div className="flex items-center justify-between">
        <Label>Example dialogue</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => commit([...items, ""])}
        >
          <Plus className="size-4" />
          Add exchange
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">
        Short sample exchanges that show how the character speaks. Use{" "}
        <code>{"{{char}}"}</code> and <code>{"{{user}}"}</code> for the names.
      </p>
      {items.map((block, index) => (
        <div key={index} className="flex items-start gap-2">
          <Textarea
            value={block}
            rows={4}
            placeholder={"{{user}}: Still open?\n{{char}}: For you? Barely."}
            onChange={(event) => {
              const next = [...items];
              next[index] = event.target.value;
              commit(next);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove exchange ${index + 1}`}
            disabled={items.length === 1 && !items[0]}
            onClick={() =>
              commit(items.filter((_, position) => position !== index))
            }
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
