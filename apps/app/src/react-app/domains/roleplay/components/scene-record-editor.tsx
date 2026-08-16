/** @jsxImportSource react */
import {
  KNOWN_SCENE_TYPES,
  MAX_SCENE_DESCRIPTION_CHARS,
  MAX_SCENE_NAME_CHARS,
  MAX_SCENE_RECORDS,
  MAX_SCENE_STATE_CHARS,
  mintSceneId,
  type SceneRecord,
} from "@openwork/types/roleplay";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SceneRecordEditorProps = {
  records: SceneRecord[];
  onChange: (records: SceneRecord[]) => void;
};

const SCENE_TYPE_LIST_ID = "roleplay-scene-types";

export function SceneRecordEditor({
  records,
  onChange,
}: SceneRecordEditorProps) {
  const full = records.length >= MAX_SCENE_RECORDS;

  const edit = (index: number, change: Partial<SceneRecord>) =>
    onChange(
      records.map((record, position) =>
        position === index ? { ...record, ...change } : record,
      ),
    );

  /**
   * Ids come from the shared minter, and an edit never touches one.
   *
   * A session's live state addresses records by the id it was seeded with, so a
   * renamed garment has to stay the same record — and a reused id would point a
   * running conversation at something it was never told about.
   */
  const add = () => {
    const id = mintSceneId(new Set(records.map((record) => record.id)));
    onChange([
      ...records,
      { id, type: "clothes", name: "", state: "", description: "" },
    ]);
  };

  const move = (index: number, step: number) => {
    const target = index + step;
    if (target < 0 || target >= records.length) return;
    const next = [...records];
    const [record] = next.splice(index, 1);
    if (record) next.splice(target, 0, record);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label>Opening scene</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={full}
          onClick={add}
        >
          <Plus className="size-4" />
          Add record
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">
        What the scene tracks from its first line: what they are wearing, where
        they are, anything that will change and should be remembered. The
        character updates these as the scene moves. Up to {MAX_SCENE_RECORDS}.
      </p>

      <datalist id={SCENE_TYPE_LIST_ID}>
        {KNOWN_SCENE_TYPES.map((type) => (
          <option key={type} value={type} />
        ))}
      </datalist>

      {records.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No records. The scene starts empty and the character adds what it
          needs.
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {records.map((record, index) => (
          <li
            key={record.id}
            className="border-dls-border flex flex-col gap-2 border-s ps-3"
          >
            <div className="flex items-center gap-2">
              <Input
                className="w-32"
                aria-label={`Record ${index + 1} type`}
                list={SCENE_TYPE_LIST_ID}
                value={record.type}
                placeholder="clothes"
                onChange={(event) => edit(index, { type: event.target.value })}
              />
              <Input
                className="flex-1"
                aria-label={`Record ${index + 1} name`}
                maxLength={MAX_SCENE_NAME_CHARS}
                value={record.name}
                placeholder="silk blouse"
                onChange={(event) => edit(index, { name: event.target.value })}
              />
              <Input
                className="w-100"
                aria-label={`Record ${index + 1} state`}
                maxLength={MAX_SCENE_STATE_CHARS}
                value={record.state}
                placeholder="worn"
                onChange={(event) => edit(index, { state: event.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Input
                className="flex-1"
                aria-label={`Record ${index + 1} description`}
                maxLength={MAX_SCENE_DESCRIPTION_CHARS}
                value={record.description}
                placeholder="Detail the character should keep in mind."
                onChange={(event) =>
                  edit(index, { description: event.target.value })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Move record ${index + 1} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ChevronUp className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Move record ${index + 1} down`}
                disabled={index === records.length - 1}
                onClick={() => move(index, 1)}
              >
                <ChevronDown className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove record ${index + 1}`}
                onClick={() =>
                  onChange(records.filter((_, position) => position !== index))
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
