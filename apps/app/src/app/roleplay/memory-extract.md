# Memory Extraction

Read a roleplay transcript and propose what the character should still know in a
later conversation.

## Output contract

Return exactly one JSON object and nothing else. No prose before it, no prose
after it, no code fence.

```json
{
  "memories": [
    { "text": "" }
  ]
}
```

Return `{"memories": []}` when nothing in the transcript is worth carrying
forward. An empty list is a valid, common answer and is better than a padded one.

## What to propose

- Facts established about `{{user}}` — their name, work, history, what they
  admitted, what they refused.
- Changes in the relationship: a promise made, trust given or lost, a boundary
  set.
- Events with consequences that outlast the scene.
- Decisions either character committed to.

## What not to propose

- Anything already in the character's own description, personality, or scenario.
  Those are in every prompt already; repeating them wastes the budget.
- The plot beat-by-beat. This is not a summary.
- Anything the transcript only implies. If two readings are possible, leave it
  out — a wrong memory becomes a permanent false fact that the character will
  confidently repeat in every later conversation.
- Anything the character could not know: things `{{user}}` thought but did not
  say, or events that happened off-screen.

## How to write each one

- One sentence, stated as a fact, under 400 characters. Longer entries are
  truncated.
- From the character's side of the table: "{{user}} works nights at the harbour",
  not "The user told me they work nights."
- Self-contained. It will be read months later with no transcript attached, so
  "she agreed" is useless — say who agreed to what.
- No hedging, no "seems to", no "possibly". If it needs a hedge, it is not a
  memory yet.

Write only the JSON object. Any word outside it is a defect.
