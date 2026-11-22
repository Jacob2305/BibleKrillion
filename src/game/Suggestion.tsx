import type { Suggestion } from "./useDive";

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** True while the answer box still holds the text the suggestion was made for. */
export function suggestionShowing(suggestion: Suggestion | null, text: string): suggestion is Suggestion {
  return !!suggestion && sameText(suggestion.text, text);
}

/**
 * The small line above the answer box after a corrected spelling: "Did you mean
 * Nehemiah?" Enter confirms; editing the text makes it go away. Keeps its
 * height when empty so the form doesn't jump.
 */
export function SuggestionLine({ suggestion, text, id }: { suggestion: Suggestion | null; text: string; id?: string }) {
  const showing = suggestionShowing(suggestion, text);
  return (
    <p id={id} role="status" className="min-h-6 text-sm leading-snug">
      {showing && (
        <>
          Did you mean <strong className="text-base text-sun-300">{suggestion.canonical}</strong>?{" "}
          <span className="text-cloud-50/75">Enter to confirm, or edit it.</span>
        </>
      )}
    </p>
  );
}
