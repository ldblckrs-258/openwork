/**
 * Lorebook entries and character memories both grow without bound and both land
 * in the same compiled prompt. Given two independently-chosen budgets they will
 * eventually sum to a prompt with no room left for the character itself, so they
 * share one ceiling and are ranked against each other rather than separately.
 *
 * The ceiling is measured in characters, not tokens. Counting real tokens needs
 * the target model's tokenizer, which this framework-free layer deliberately has
 * no access to. Characters are a deliberate over-estimate of safety: for English
 * prose a character is well under a token, so this cuts sooner than a token
 * budget would, never later.
 */
export const CONTEXTUAL_INJECTION_BUDGET_CHARS = 8_000;

export type BudgetedInjection = {
  text: string;
  priority?: number;
};

export type ContextualInjectionResult = {
  kept: string[];
  /** Index into the input array for each kept entry, so callers can tell merged sources apart. */
  keptIndices: number[];
  dropped: number;
};

/**
 * Keep as many injections as fit the shared ceiling, discarding lowest-priority
 * entries first per the Card V2 rule, while preserving the caller's ordering in
 * the output so insertion order still decides placement.
 */
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
