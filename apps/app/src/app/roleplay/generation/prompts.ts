import { roleplayPromptOptions, type RoleplayPromptOptions } from "../prompt-options.js";
import characterCreatorPrompt from "./character-creator.md?raw";
import characterInterviewPrompt from "./character-interview.md?raw";
import type { InterviewQuestion } from "./parse-generated.js";

/**
 * The two generation calls, assembled where the tool boundary is applied.
 *
 * Generation is an ordinary model call whose output flows straight into a card,
 * so it runs behind the same boundary a roleplay turn does — pinned agent,
 * `tools: {"*": false}` — rather than behind a second, parallel one that could
 * drift away from it. `roleplayPromptOptions` is the only way either request is
 * built, and it takes no tool map.
 *
 * The prompt documents are markdown files rather than string literals so they can
 * be edited without touching code. Generation quality lives almost entirely in
 * them: when output disappoints, the fix belongs in the `.md`, not here.
 */

export { characterCreatorPrompt, characterInterviewPrompt };

export type GenerationRequest = RoleplayPromptOptions & { text: string };

export type InterviewAnswer = { question: string; answer: string };

function ideaBlock(idea: string): string {
  return `# The idea\n\n${idea.trim()}`;
}

export function buildInterviewRequest(idea: string): GenerationRequest {
  return { ...roleplayPromptOptions(characterInterviewPrompt), text: ideaBlock(idea) };
}

/**
 * Build the card-writing call.
 *
 * Interview answers are appended to the idea rather than sent as a second turn:
 * the interview and the generation are separate calls in separate sessions, so
 * there is no shared history for the model to remember them from.
 *
 * Unanswered questions are dropped. A question echoed back with an empty answer
 * reads to the model as "the user declined to have an opinion", which is not
 * what skipping a field means.
 */
export function buildCreatorRequest(input: { idea: string; answers?: InterviewAnswer[] }): GenerationRequest {
  const answered = (input.answers ?? []).filter((entry) => entry.answer.trim() !== "");
  const sections = [ideaBlock(input.idea)];

  if (answered.length > 0) {
    sections.push(
      ["# What the user said when asked", ...answered.map((entry) => `Q: ${entry.question}\nA: ${entry.answer.trim()}`)].join(
        "\n\n",
      ),
    );
  }

  return { ...roleplayPromptOptions(characterCreatorPrompt), text: sections.join("\n\n") };
}

export function answersForQuestions(
  questions: InterviewQuestion[],
  answersById: Record<string, string>,
): InterviewAnswer[] {
  return questions.map((question) => ({ question: question.question, answer: answersById[question.id] ?? "" }));
}
