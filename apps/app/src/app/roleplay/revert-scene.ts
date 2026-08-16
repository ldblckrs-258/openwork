import type {
  RoleplaySceneState,
  RoleplayTurnRecord,
} from "@openwork/types/roleplay";

export type RewindMessage = { id: string; role: string };

export type SceneRewind = {
  restore: RoleplaySceneState | undefined;
  discardedTurnIds: string[];
};

const NOTHING: SceneRewind = { restore: undefined, discardedTurnIds: [] };

function cutIndex(
  messages: RewindMessage[],
  boundaryMessageId: string,
): number | null {
  const index = messages.findIndex(
    (message) => message.id === boundaryMessageId,
  );
  if (index < 0) return null;
  if (messages[index]?.role === "user") return index;

  for (let position = index - 1; position >= 0; position -= 1) {
    if (messages[position]?.role === "user") return position;
  }
  return 0;
}

export function planSceneRewind(input: {
  messages: RewindMessage[];
  boundaryMessageId: string;
  turns: RoleplayTurnRecord[];
}): SceneRewind {
  const cut = cutIndex(input.messages, input.boundaryMessageId);
  if (cut === null) return NOTHING;

  const positions = new Map(
    input.messages.map((message, index) => [message.id, index]),
  );
  const discarded = input.turns
    .map((turn) => ({ turn, position: positions.get(turn.messageId) }))
    .filter(
      (entry): entry is { turn: RoleplayTurnRecord; position: number } =>
        entry.position !== undefined,
    )
    .filter((entry) => entry.position >= cut)
    .sort(
      (left, right) =>
        left.position - right.position ||
        left.turn.createdAt - right.turn.createdAt,
    );

  return {
    restore: discarded.find(
      (entry) => entry.turn.sceneStateBefore !== undefined,
    )?.turn.sceneStateBefore,
    discardedTurnIds: discarded.map((entry) => entry.turn.turnId),
  };
}
