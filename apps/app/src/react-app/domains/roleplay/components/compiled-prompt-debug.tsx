/** @jsxImportSource react */
import * as React from "react";
import { Copy } from "lucide-react";
import type { RoleplayPersona, RoleplaySceneState } from "@openwork/types/roleplay";
import type { RoleplayCharacterRecord } from "@openwork/types/roleplay";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { compilePrompt } from "@/app/roleplay/compile-prompt";
import type { SkillInjection } from "@/app/roleplay/skills-injection";

type CompiledPromptDebugProps = {
  character: RoleplayCharacterRecord;
  persona: RoleplayPersona;
  skills?: SkillInjection[];
  sceneState?: RoleplaySceneState;
};

export function CompiledPromptDebug({ character, persona, skills, sceneState }: CompiledPromptDebugProps) {
  const compiled = React.useMemo(
    () =>
      compilePrompt(character.card, persona, {
        charName: character.charSubstitutionName || undefined,
        skills: skills ?? [],
        ...(sceneState ? { sceneState } : {}),
      }),
    [character, persona, skills, sceneState],
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
