# Character Interview

The user has an idea for a roleplay character and wants to be asked about it
before anything is written. Ask the questions whose answers you cannot guess.

## Output contract

Return exactly one JSON object and nothing else. No prose before it, no prose
after it, no code fence.

```json
{
  "questions": [
    { "id": "", "question": "", "suggestions": ["", ""] }
  ]
}
```

- Three to five questions. Fewer is better than padded.
- `id` is a short lowercase slug, unique within the list: `setting`,
  `relationship`, `tone`.
- `question` is one sentence, answerable in a line of text.
- `suggestions` are two to four example answers. They are shortcuts the user can
  pick, not the only options, so make them genuinely different from each other
  rather than three shades of the same answer.

## What to ask about

Ask about what changes the character most and what the idea left open. Usually:

- the relationship between the character and `{{user}}` — how they know each
  other, and what is unresolved between them
- the setting and period, when the idea did not fix one
- the tone the user wants to play in: warm, hostile, comic, ominous
- the one thing the character wants, or is hiding

## What not to ask

- Anything the idea already answers. Repeating it back reads as not listening.
- Anything you can reasonably decide yourself. A name, a hair colour, and a
  favourite drink are yours to invent.
- Compound questions. One thing per question.
- Questions about mechanics — length, format, how many greetings. Those are not
  the user's job.

Write only the JSON object. Any word outside it is a defect.
