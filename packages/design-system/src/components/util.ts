// Joins class names — falsy·empty values are dropped. This is the only utility in this package.
export const cx = (...parts: readonly (string | false | null | undefined)[]): string =>
  parts.filter((p): p is string => typeof p === "string" && p !== "").join(" ");

// Shows only the front of a long identifier (contract id·party id·hash). **It changes no value** — notation.
// The caller leaves the original text behind in a title.
export const truncate = (s: string, n = 12): string => (s.length > n * 2 ? `${s.slice(0, n)}…` : s);

// Delegation for "the whole row is a link" — a press on a link·button·input inside wins instead.
// Where it goes is not known to this package: the caller decides inside onActivate.
const INTERACTIVE = "a, button, input, select, textarea, details, summary, label";
export function activateHandlers(onActivate: () => void): {
  onClick: (event: { target: EventTarget | null }) => void;
  onKeyDown: (event: { key: string; target: EventTarget | null }) => void;
} {
  const go = (target: EventTarget | null) => {
    if (target instanceof Element && target.closest(INTERACTIVE) !== null) return;
    onActivate();
  };
  return {
    onClick: (event) => go(event.target),
    onKeyDown: (event) => {
      if (event.key === "Enter") go(event.target);
    },
  };
}
