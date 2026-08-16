export const CONTEXTUAL_INJECTION_BUDGET_CHARS = 8_000;

export type BudgetedInjection = {
  text: string;
  priority?: number;
};

export type ContextualInjectionResult = {
  kept: string[];
  keptIndices: number[];
  dropped: number;
};

export function applyContextualInjectionBudget(
  injections: BudgetedInjection[],
  budgetChars: number = CONTEXTUAL_INJECTION_BUDGET_CHARS,
): ContextualInjectionResult {
  const ranked = injections
    .map((injection, index) => ({ injection, index }))
    .sort((left, right) => {
      const byPriority = (right.injection.priority ?? 0) - (left.injection.priority ?? 0);
      return byPriority !== 0 ? byPriority : left.index - right.index;
    });

  const keptIndices = new Set<number>();
  let used = 0;
  for (const { injection, index } of ranked) {
    const cost = injection.text.length;
    if (used + cost > budgetChars) continue;
    used += cost;
    keptIndices.add(index);
  }

  const order = injections.map((_, index) => index).filter((index) => keptIndices.has(index));
  const kept = order.map((index) => injections[index]?.text ?? "");
  return { kept, keptIndices: order, dropped: injections.length - order.length };
}
