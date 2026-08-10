/** @jsxImportSource react */
import * as React from "react";
import { Copy } from "lucide-react";
import type { RoleplayPersona } from "@openwork/types/roleplay";
import type { RoleplayCharacterRecord } from "@openwork/types/roleplay";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { compilePrompt } from "@/app/roleplay/compile-prompt";

type CompiledPromptDebugProps = {
  character: RoleplayCharacterRecord;
  persona: RoleplayPersona;
};

/**
 * Shows exactly the string the compiler produces for this character and persona.
 *
 * "This character feels wrong" is the most likely quality failure and the hardest
 * to attribute — composition order is a decision this app made, not a spec, and
 * a card authored against another app may land differently here. Without this
 * view the only way to debug that is guesswork about text the user never sees.
 */
export function CompiledPromptDebug({ character, persona }: CompiledPromptDebugProps) {
  const compiled = React.useMemo(
    () => compilePrompt(character.card, persona, { charName: character.charSubstitutionName || undefined }),
    [character, persona],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Compiled prompt</p>
          <p className="text-muted-foreground text-xs">
            The exact system text sent for each turn. Chat history follows it.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(compiled).then(
              () => toast.success("Compiled prompt copied"),
              () => toast.error("Could not copy the compiled prompt"),
            );
          }}
        >
          <Copy className="size-4" />
          Copy
        </Button>
      </div>
      <pre className="bg-muted max-h-96 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">{compiled}</pre>
      <p className="text-muted-foreground text-xs">
        {compiled.length.toLocaleString()} characters
      </p>
    </div>
  );
}
