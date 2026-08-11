import * as React from "react"

import { substituteMacros } from "@/app/roleplay/macros"
import { segmentRoleplayText, type RoleplaySegmentKind } from "@/app/roleplay/render-segments"
import { cn } from "@/lib/utils"

/**
 * Who `{{char}}` and `{{user}}` resolve to in this session's transcript.
 *
 * Present only while a session is bound to a character; its absence is what
 * makes every other conversation render exactly as it did before.
 */
export interface RoleplayRenderContext {
  charName: string
  userName: string
}

const SEGMENT_CLASS: Record<RoleplaySegmentKind, string> = {
  narration: "",
  speech: "text-(--rp-speech)",
  action: "text-(--rp-action) italic",
  ooc: "text-(--rp-ooc)",
}

/**
 * Render one roleplay message.
 *
 * Two jobs, both of which have to happen at render time rather than in storage.
 *
 * Macros are substituted here because the stored text is the card author's and
 * the model's: a greeting is `first_mes` verbatim, and a model that writes
 * `{{user}}` mid-sentence means the persona's name. Rewriting either on the way
 * into the store would make the same message wrong the moment the persona is
 * renamed, and would corrupt a card on export.
 *
 * Colouring replaces the markdown pass for roleplay turns. Roleplay prose is
 * not markdown — its asterisks and quotes are stage directions, not syntax —
 * and running it through a markdown renderer turned `*shrugs*` into italics
 * while leaving speech and asides indistinguishable from narration.
 */
export function RoleplayText({
  text,
  context,
  className,
}: {
  text: string
  context: RoleplayRenderContext
  className?: string
}) {
  const segments = React.useMemo(
    () =>
      segmentRoleplayText(
        substituteMacros(text, { char: context.charName, user: context.userName }),
      ),
    [text, context.charName, context.userName],
  )

  return (
    <p className={cn("whitespace-pre-wrap", className)}>
      {segments.map((segment, index) => {
        const classes = SEGMENT_CLASS[segment.kind]
        return classes ? (
          <span key={index} className={classes}>
            {segment.text}
          </span>
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        )
      })}
    </p>
  )
}
