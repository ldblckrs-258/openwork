/** @jsxImportSource react */
import type { RoleplayCharacterRecord } from "@openwork/types/roleplay";
import { Sparkles } from "lucide-react";
import * as React from "react";

import { createCharacterId } from "@/app/roleplay/character-draft";
import {
  generatedCharacterRecord,
  parseGeneratedCard,
  parseInterviewQuestions,
  type InterviewQuestion,
} from "@/app/roleplay/generation/parse-generated";
import {
  answersForQuestions,
  buildCreatorRequest,
  buildInterviewRequest,
  type GenerationRequest,
} from "@/app/roleplay/generation/prompts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

type CharacterGenerateProps = {
  /** Runs one model call behind the roleplay tool boundary and returns its text. */
  onRun: (request: GenerationRequest) => Promise<string>;
  /** Hands the result to the editor. Nothing is saved here. */
  onGenerated: (character: RoleplayCharacterRecord) => void;
  onCancel: () => void;
};

type Stage = "idea" | "interview";

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Generate a character from a sentence.
 *
 * This page never writes to the store. A finished generation is handed to the
 * Phase 4 editor as an unsaved record, so the review step is the same editor the
 * user would have filled in by hand — and a generation they dislike is discarded
 * by cancelling, not by deleting a character that was already persisted.
 */
export function CharacterGenerate({ onRun, onGenerated, onCancel }: CharacterGenerateProps) {
  const [idea, setIdea] = React.useState("");
  const [stage, setStage] = React.useState<Stage>("idea");
  const [questions, setQuestions] = React.useState<InterviewQuestion[]>([]);
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<"interview" | "card" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const ideaReady = idea.trim() !== "";

  const runInterview = async () => {
    setBusy("interview");
    setError(null);
    try {
      const parsed = parseInterviewQuestions(await onRun(buildInterviewRequest(idea)));
      if (!parsed.ok) {
        setError("The interview questions came back unreadable. Try again, or generate without them.");
        return;
      }
      setQuestions(parsed.questions);
      setStage("interview");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reach the model.");
    } finally {
      setBusy(null);
    }
  };

  const runGeneration = async () => {
    setBusy("card");
    setError(null);
    try {
      const request = buildCreatorRequest({
        idea,
        answers: stage === "interview" ? answersForQuestions(questions, answers) : undefined,
      });
      const parsed = parseGeneratedCard(await onRun(request));
      if (!parsed.ok) {
        // Rejected rather than partially salvaged: a card assembled from whatever
        // fields survived would reach the editor looking finished while missing
        // the parts that carry the character.
        setError(`The character came back unreadable. ${parsed.error}`);
        return;
      }
      onGenerated(generatedCharacterRecord(parsed.card, createCharacterId(Date.now(), randomSuffix()), Date.now()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reach the model.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-10 py-6">
      <div>
        <h3 className="text-sm font-medium">Generate a character</h3>
        <p className="text-muted-foreground text-sm">
          Describe the character in a sentence. You review and edit everything before it is saved.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="character-idea">Your idea</Label>
        <Textarea
          id="character-idea"
          rows={3}
          value={idea}
          placeholder="A night-shift archivist who guards one shelf and will not say why."
          disabled={busy !== null}
          onChange={(event) => setIdea(event.target.value)}
        />
      </div>

      {stage === "interview" ? (
        <>
          <Separator />
          <section className="flex flex-col gap-4">
            <div>
              <h4 className="text-sm font-medium">A few questions first</h4>
              <p className="text-muted-foreground text-sm">
                Answer what you have an opinion about. Anything you leave blank is the model&apos;s to invent.
              </p>
            </div>
            {questions.map((question) => (
              <div key={question.id} className="flex flex-col gap-2">
                <Label htmlFor={`interview-${question.id}`}>{question.question}</Label>
                <Input
                  id={`interview-${question.id}`}
                  value={answers[question.id] ?? ""}
                  disabled={busy !== null}
                  onChange={(event) =>
                    setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                  }
                />
                {question.suggestions.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {question.suggestions.map((suggestion) => (
                      <Button
                        key={suggestion}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() =>
                          setAnswers((current) => ({ ...current, [question.id]: suggestion }))
                        }
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </section>
        </>
      ) : null}

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" disabled={busy !== null} onClick={onCancel}>
          Cancel
        </Button>
        {stage === "idea" ? (
          <Button
            type="button"
            variant="outline"
            disabled={!ideaReady || busy !== null}
            onClick={() => void runInterview()}
          >
            {busy === "interview" ? "Thinking…" : "Ask me first"}
          </Button>
        ) : null}
        <Button type="button" disabled={!ideaReady || busy !== null} onClick={() => void runGeneration()}>
          <Sparkles className="size-4" />
          {busy === "card" ? "Writing the character…" : "Generate"}
        </Button>
      </div>
    </div>
  );
}
