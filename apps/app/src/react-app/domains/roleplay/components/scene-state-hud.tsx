/** @jsxImportSource react */
import {
  KNOWN_SCENE_TYPES,
  MAX_SCENE_DESCRIPTION_CHARS,
  MAX_SCENE_NAME_CHARS,
  MAX_SCENE_STATE_CHARS,
  type RoleplaySceneState,
  type SceneRecord,
  type SceneStatePatch,
} from "@openwork/types/roleplay";
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import * as React from "react";

import {
  changedSceneRecordIds,
  groupSceneRecords,
  orderSceneGroupsByRecency,
  sceneTypeLabel,
} from "@/app/roleplay/scene-state";
import { styleForType } from "./scene-type-style";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SCENE_HIGHLIGHT_MS = 2_400;

const SCENE_TYPE_LIST_ID = "roleplay-hud-scene-types";
const CLOTHES_STATE_LIST_ID = "roleplay-hud-clothes-states";

const CLOTHES_STATES = ["worn", "displaced", "removed"] as const;

export type SceneStateHudProps = {
  state: RoleplaySceneState;
  busy: boolean;
  error: string | null;
  onPatch: (patch: SceneStatePatch) => void;
  onDismissError: () => void;
  className?: string;
};

function CommitInput(props: {
  label: string;
  srLabel: string;
  value: string;
  placeholder?: string;
  maxLength: number;
  listId?: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = React.useState(props.value);
  React.useEffect(() => setDraft(props.value), [props.value]);

  return (
    <label className="flex flex-col gap-1">
      <span className="text-dls-secondary text-[11px] font-medium">{props.label}</span>
      <Input
        className="h-8 text-xs"
        aria-label={props.srLabel}
        value={draft}
        disabled={props.disabled}
        maxLength={props.maxLength}
        {...(props.placeholder ? { placeholder: props.placeholder } : {})}
        {...(props.listId ? { list: props.listId } : {})}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== props.value) props.onCommit(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setDraft(props.value);
        }}
      />
    </label>
  );
}

export function SceneStateHud({ state, busy, error, onPatch, onDismissError, className }: SceneStateHudProps) {
  const [open, setOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [newType, setNewType] = React.useState("clothes");
  const [newName, setNewName] = React.useState("");
  const [changed, setChanged] = React.useState<readonly string[]>([]);

  const previousRecords = React.useRef<SceneRecord[] | null>(null);
  const [recentTypes, setRecentTypes] = React.useState<readonly string[]>([]);

  React.useEffect(() => {
    const before = previousRecords.current;
    previousRecords.current = state.records;
    if (!before) return;

    const ids = changedSceneRecordIds(before, state.records);
    if (ids.length === 0) return;

    const touched = new Set(ids);
    const types = state.records.filter((record) => touched.has(record.id)).map((record) => record.type);
    setRecentTypes((current) => [...new Set([...types, ...current])]);

    setChanged(ids);
    const timer = setTimeout(() => setChanged([]), SCENE_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [state.records]);

  const groups = React.useMemo(
    () => orderSceneGroupsByRecency(groupSceneRecords(state.records), recentTypes),
    [state.records, recentTypes],
  );

  const patch = (body: Omit<SceneStatePatch, "revision">) => onPatch({ ...body, revision: state.revision });

  const submitNew = () => {
    const type = newType.trim();
    if (!type) return;
    patch({ upsert: [{ type, name: newName.trim() }] });
    setNewName("");
    setAdding(false);
  };

  const changedSet = new Set(changed);
  const live = changed.length > 0;

  const toggle = (
    <>
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        {busy ? (
          <Loader2 className="text-dls-secondary size-3.5 animate-spin motion-reduce:animate-none" />
        ) : error ? (
          <AlertTriangle className="text-amber-11 size-3.5" />
        ) : (
          <SceneStatusDot live={live} />
        )}
      </span>
      <span className="text-xs font-medium tracking-tight">Scene</span>
      <span className="text-dls-secondary text-xs tabular-nums">{state.records.length}</span>
    </>
  );

  const dots = (
    <span className="flex items-center gap-1" aria-hidden>
      {groups.slice(0, 4).map((group) => {
        const style = styleForType(group.type);
        const moved = group.records.some((record) => changedSet.has(record.id));
        return (
          <span
            key={group.label}
            className={`size-1.5 rounded-full transition-transform duration-200 motion-reduce:transition-none ${style.dot} ${
              moved ? "scale-150" : ""
            }`}
          />
        );
      })}
      {groups.length > 4 ? <span className="text-dls-secondary text-[11px] tabular-nums">+{groups.length - 4}</span> : null}
    </span>
  );

  return (
    <div className={`pointer-events-auto flex w-auto max-w-full flex-col items-end gap-2 ${className ?? ""}`}>
      {open ? (
        <div
          id="roleplay-scene-panel"
          className="border-dls-border bg-dls-surface flex max-h-[70vh] w-[min(22rem,100%)] flex-col overflow-hidden rounded-2xl border shadow-sm"
        >
          <div className="border-dls-border flex items-center gap-2 border-b px-3 py-2">
            <button
              type="button"
              className="focus-visible:ring-dls-accent focus-visible:ring-offset-dls-surface flex flex-1 items-center gap-2 rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              aria-expanded
              aria-controls="roleplay-scene-panel"
              onClick={() => setOpen(false)}
            >
              {toggle}
              <span className="flex-1" />
              <ChevronDown className="text-dls-secondary size-3.5" />
            </button>
          </div>

          {error ? (
            <div className="border-amber-6 bg-amber-2 flex items-start gap-2 border-b px-3 py-2">
              <AlertTriangle className="text-amber-11 mt-px size-3.5 shrink-0" />
              <span className="text-amber-11 min-w-0 flex-1 break-words text-xs">{error}</span>
              <button
                type="button"
                className="text-amber-11 focus-visible:ring-dls-accent hover:bg-amber-4 relative rounded p-1 transition-colors duration-200 before:absolute before:-inset-3 before:content-[''] focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
                aria-label="Dismiss scene error"
                onClick={onDismissError}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : null}

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-3 py-3">
            <datalist id={SCENE_TYPE_LIST_ID}>
              {KNOWN_SCENE_TYPES.map((type) => (
                <option key={type} value={type} />
              ))}
            </datalist>
            <datalist id={CLOTHES_STATE_LIST_ID}>
              {CLOTHES_STATES.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>

            {groups.map((group) => {
              const style = styleForType(group.type);
              const GroupIcon = style.icon;
              return (
                <div key={group.label} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 px-1">
                    <GroupIcon className={`size-3 ${style.label}`} />
                    <span className={`text-[11px] font-semibold uppercase tracking-[0.1em] ${style.label}`}>
                      {group.label}
                    </span>
                    <span className="text-dls-secondary text-[11px] tabular-nums">{group.records.length}</span>
                  </div>

                  {group.records.map((record) => {
                    const editing = editingId === record.id;
                    return (
                      <div
                        key={record.id}
                        className={`rounded-lg transition-colors duration-500 motion-reduce:transition-none ${
                          changedSet.has(record.id) ? style.wash : ""
                        }`}
                      >
                        <button
                          type="button"
                          className="group hover:bg-dls-hover focus-visible:ring-dls-accent focus-visible:ring-offset-dls-surface flex w-full items-start gap-2 rounded-lg px-2 py-2 text-start transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none"
                          aria-expanded={editing}
                          onClick={() => setEditingId((current) => (current === record.id ? null : record.id))}
                        >
                          <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${style.dot}`} />
                          <span className="min-w-0 flex-1">
                            <span className="text-dls-text block break-words text-xs font-medium">
                              {record.name.trim() === "" ? sceneTypeLabel(record.type) : record.name}
                            </span>
                            {record.state.trim() === "" ? null : (
                              <span className="text-dls-secondary block break-words text-xs">{record.state}</span>
                            )}
                            {record.description.trim() === "" ? null : (
                              <span className="text-dls-secondary block break-words text-[11px] italic">
                                {record.description}
                              </span>
                            )}
                          </span>
                          {record.count === undefined ? null : (
                            <span className="bg-dls-active text-dls-text mt-0.5 shrink-0 rounded px-2 py-0.5 text-[11px] tabular-nums">
                              ×{record.count}
                            </span>
                          )}
                          <Pencil
                            className={`text-dls-secondary mt-0.5 size-3 shrink-0 transition-opacity duration-200 motion-reduce:transition-none ${
                              editing ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                            }`}
                          />
                        </button>

                        {editing ? (
                          <div className="flex flex-col gap-2 px-2 pb-2 pt-1">
                            <CommitInput
                              label="Name"
                              srLabel={`${record.id} name`}
                              value={record.name}
                              placeholder={sceneTypeLabel(record.type)}
                              maxLength={MAX_SCENE_NAME_CHARS}
                              disabled={busy}
                              onCommit={(name) => patch({ upsert: [{ id: record.id, name }] })}
                            />
                            <CommitInput
                              label="State"
                              srLabel={`${record.id} state`}
                              value={record.state}
                              placeholder="worn"
                              maxLength={MAX_SCENE_STATE_CHARS}
                              disabled={busy}
                              {...(record.type === "clothes" ? { listId: CLOTHES_STATE_LIST_ID } : {})}
                              onCommit={(value) => patch({ upsert: [{ id: record.id, state: value }] })}
                            />
                            <CommitInput
                              label="Description"
                              srLabel={`${record.id} description`}
                              value={record.description}
                              placeholder="Authored detail the prompt may use"
                              maxLength={MAX_SCENE_DESCRIPTION_CHARS}
                              disabled={busy}
                              onCommit={(description) => patch({ upsert: [{ id: record.id, description }] })}
                            />
                            <div className="flex items-center gap-1">
                              {record.count === undefined ? null : (
                                <>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="size-7"
                                    aria-label={`Decrease ${record.id} count`}
                                    disabled={busy || record.count === 0}
                                    onClick={() => patch({ upsert: [{ id: record.id, countDelta: -1 }] })}
                                  >
                                    <Minus className="size-3.5" />
                                  </Button>
                                  <span className="w-7 text-center text-xs tabular-nums">{record.count}</span>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="size-7"
                                    aria-label={`Increase ${record.id} count`}
                                    disabled={busy}
                                    onClick={() => patch({ upsert: [{ id: record.id, countDelta: 1 }] })}
                                  >
                                    <Plus className="size-3.5" />
                                  </Button>
                                </>
                              )}
                              <span className="flex-1" />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-ruby-11 hover:bg-ruby-3 hover:text-ruby-11 size-7"
                                aria-label={`Remove ${record.id}`}
                                disabled={busy}
                                onClick={() => {
                                  setEditingId(null);
                                  patch({ remove: [record.id] });
                                }}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {adding ? (
              <div className="border-dls-border flex flex-col gap-2 rounded-lg border border-dashed p-2">
                <CommitInput
                  label="Type"
                  srLabel="New record type"
                  value={newType}
                  placeholder="clothes"
                  maxLength={24}
                  listId={SCENE_TYPE_LIST_ID}
                  disabled={busy}
                  onCommit={setNewType}
                />
                <CommitInput
                  label="Name"
                  srLabel="New record name"
                  value={newName}
                  placeholder="silk blouse"
                  maxLength={MAX_SCENE_NAME_CHARS}
                  disabled={busy}
                  onCommit={setNewName}
                />
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" className="h-7 text-xs" disabled={busy} onClick={submitNew}>
                    Add
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setAdding(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-dls-secondary h-8 w-full border-dashed text-xs"
                disabled={busy}
                onClick={() => setAdding(true)}
              >
                <Plus className="size-3.5" />
                Add record
              </Button>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={`border-dls-border bg-dls-surface hover:bg-dls-hover focus-visible:ring-dls-accent focus-visible:ring-offset-dls-surface relative flex h-8 items-center gap-2 rounded-full border px-3 shadow-sm transition-colors duration-200 before:absolute before:-inset-2 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-px motion-reduce:transition-none ${
            error ? "border-amber-6" : ""
          }`}
          aria-expanded={false}
          aria-controls="roleplay-scene-panel"
          onClick={() => setOpen(true)}
        >
          {toggle}
          {dots}
          <ChevronDown className="text-dls-secondary size-3.5" />
        </button>
      )}

      {!open && error ? (
        <div className="border-amber-6 bg-amber-2 flex w-[min(20rem,100%)] items-start gap-2 rounded-lg border px-3 py-2 shadow-sm">
          <AlertTriangle className="text-amber-11 mt-px size-3.5 shrink-0" />
          <span className="text-amber-11 min-w-0 flex-1 break-words text-xs">{error}</span>
          <button
            type="button"
            className="text-amber-11 focus-visible:ring-dls-accent hover:bg-amber-4 relative rounded p-1 transition-colors duration-200 before:absolute before:-inset-3 before:content-[''] focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
            aria-label="Dismiss scene error"
            onClick={onDismissError}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SceneStatusDot({ live }: { live: boolean }) {
  return (
    <>
      <span
        className={`bg-jade-9 absolute size-4 rounded-full opacity-40 ${
          live ? "animate-ping motion-reduce:animate-none" : "hidden"
        }`}
      />
      <span className={`relative size-2 rounded-full ${live ? "bg-jade-9" : "bg-dls-active"}`} />
    </>
  );
}
