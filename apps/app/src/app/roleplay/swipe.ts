import type {
  RoleplayAlternative,
  RoleplaySceneState,
  RoleplayTurnRecord,
} from "@openwork/types/roleplay";

export type SceneRestore = RoleplaySceneState | undefined;

export type SwipePlan = {
  revertMessageId: string;
  userText: string;
  turn: RoleplayTurnRecord;
  restore: SceneRestore;
};

export type SwipeInput = {
  turn: RoleplayTurnRecord;
  currentReply: { text: string; messageId: string };
  sceneState?: RoleplaySceneState;
  now: number;
};

function alreadyCaptured(
  alternatives: RoleplayAlternative[],
  messageId: string,
): boolean {
  return alternatives.some(
    (alternative) => alternative.messageId === messageId,
  );
}

export function planSwipe(input: SwipeInput): SwipePlan {
  const captured = alreadyCaptured(
    input.turn.alternatives,
    input.currentReply.messageId,
  )
    ? input.turn.alternatives
    : [
        ...input.turn.alternatives,
        {
          text: input.currentReply.text,
          messageId: input.currentReply.messageId,
          ...(input.sceneState ? { sceneState: input.sceneState } : {}),
          createdAt: input.now,
        },
      ];

  return {
    revertMessageId: input.currentReply.messageId,
    userText: input.turn.userText,
    turn: {
      ...input.turn,
      alternatives: captured,
      activeAlternative: captured.length,
    },
    restore: input.turn.sceneStateBefore,
  };
}

export function applySwipeResult(
  turn: RoleplayTurnRecord,
  result: {
    userMessageId: string;
    replyText: string;
    replyMessageId: string;
    sceneState?: RoleplaySceneState;
    now: number;
  },
): RoleplayTurnRecord {
  const alternatives = alreadyCaptured(turn.alternatives, result.replyMessageId)
    ? turn.alternatives
    : [
        ...turn.alternatives,
        {
          text: result.replyText,
          messageId: result.replyMessageId,
          ...(result.sceneState ? { sceneState: result.sceneState } : {}),
          createdAt: result.now,
        },
      ];
  return {
    ...turn,
    messageId: result.userMessageId,
    alternatives,
    activeAlternative: alternatives.length - 1,
  };
}

export type SwipeFailureRepair = {
  restoredReply: RoleplayAlternative | undefined;
  danglingUserMessage: boolean;
  turn: RoleplayTurnRecord;
  restore: SceneRestore;
};

export function repairAfterFailedSwipe(
  turn: RoleplayTurnRecord,
): SwipeFailureRepair {
  const restoredReply = turn.alternatives[turn.alternatives.length - 1];
  return {
    restoredReply,
    danglingUserMessage: restoredReply === undefined,
    turn: {
      ...turn,
      activeAlternative: Math.max(turn.alternatives.length - 1, 0),
    },
    restore: turn.sceneStateBefore,
  };
}

export type AlternativeSelection = {
  turn: RoleplayTurnRecord;
  changed: boolean;
  restore: SceneRestore;
};

export function selectAlternative(
  turn: RoleplayTurnRecord,
  offset: number,
): AlternativeSelection {
  if (turn.alternatives.length === 0)
    return { turn, changed: false, restore: undefined };
  const next = Math.min(
    Math.max(turn.activeAlternative + offset, 0),
    turn.alternatives.length - 1,
  );
  if (next === turn.activeAlternative)
    return { turn, changed: false, restore: undefined };
  return {
    turn: { ...turn, activeAlternative: next },
    changed: true,
    restore: turn.alternatives[next]?.sceneState,
  };
}

export function activeAlternativeText(
  turn: RoleplayTurnRecord,
): string | undefined {
  return turn.alternatives[turn.activeAlternative]?.text;
}

export function createTurnId(now: number, suffix: string): string {
  return `turn_${now.toString(36)}_${suffix}`;
}
