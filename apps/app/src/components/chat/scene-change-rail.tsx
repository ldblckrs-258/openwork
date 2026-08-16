/** @jsxImportSource react */
import type { RoleplaySceneChangeRecord } from "@openwork/types/roleplay"
import { KNOWN_SCENE_TYPES } from "@openwork/types/roleplay"
import { ChevronRight } from "lucide-react"
import * as React from "react"

import { MAX_RENDERED_SCENE_CHANGES } from "@/app/roleplay/scene-changes"
import { sceneTypeLabel } from "@/app/roleplay/scene-state"
import { styleForType } from "@/react-app/domains/roleplay/components/scene-type-style"

function changedKinds(records: RoleplaySceneChangeRecord[]): string[] {
  const known = new Set<string>(KNOWN_SCENE_TYPES)
  const seen = new Set<string>()
  const kinds: string[] = []
  for (const record of records) {
    const kind = known.has(record.type) ? record.type : "other"
    if (seen.has(kind)) continue
    seen.add(kind)
    kinds.push(kind)
  }
  return kinds
}

function visibleChanges(records: RoleplaySceneChangeRecord[]) {
  return {
    shown: records.slice(0, MAX_RENDERED_SCENE_CHANGES),
    hidden: Math.max(0, records.length - MAX_RENDERED_SCENE_CHANGES),
  }
}

function SceneChangeChip({ record }: { record: RoleplaySceneChangeRecord }) {
  const style = styleForType(record.type)
  const Icon = style.icon
  const name = record.name.trim() || sceneTypeLabel(record.type)
  const state = record.state.trim()

  return (
    <span className={`${style.wash} inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1`}>
      <Icon className={`${style.label} size-3 shrink-0`} aria-hidden />
      <span className={`${style.label} break-words text-[11px] font-medium leading-4`}>
        {record.kind === "added" ? `+ ${name}` : name}
      </span>
      {state ? <span className={`${style.label} break-words text-[11px] leading-4`}>{state}</span> : null}
    </span>
  )
}

export function SceneChangeRail({ records }: { records: RoleplaySceneChangeRecord[] }) {
  const [open, setOpen] = React.useState(false)
  const panelId = React.useId()
  if (records.length === 0) return null
  const { shown, hidden } = visibleChanges(records)
  const kinds = changedKinds(records)

  return (
    <div className="mx-auto w-full max-w-3xl px-2 md:px-8">
      <div className="border-dls-border border-t pt-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((previous) => !previous)}
          className="text-dls-secondary hover:text-dls-text focus-visible:ring-dls-accent focus-visible:ring-offset-dls-surface relative flex items-center gap-2 rounded-sm transition-colors duration-200 before:absolute before:-inset-3 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-px motion-reduce:transition-none"
        >
          <ChevronRight
            className={`size-3 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
            aria-hidden
          />
          <span className="text-[11px] font-medium uppercase leading-4 tracking-[0.1em]">Scene</span>
          {open ? null : (
            <span className="flex items-center gap-1" aria-hidden>
              {kinds.map((kind) => (
                <span key={kind} className={`${styleForType(kind).dot} size-1.5 rounded-full`} />
              ))}
            </span>
          )}
          <span className="text-[11px] leading-4 tabular-nums">{records.length}</span>
        </button>
        {open ? (
          <div id={panelId} className="flex flex-wrap items-center gap-2 pt-2">
            {shown.map((record) => (
              <SceneChangeChip key={`${record.id}-${record.name}-${record.state}`} record={record} />
            ))}
            {hidden > 0 ? (
              <span className="text-dls-secondary text-[11px] leading-4 tabular-nums">+{hidden} more</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
