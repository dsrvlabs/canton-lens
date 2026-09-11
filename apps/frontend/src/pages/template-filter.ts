// **"All" for the template filter** — the Contracts and Transactions lists share this control.
// The field is free text and leaving it empty is exactly "all" (an empty value drops out of the query).
// But **"empty" does not look like a choice** — to someone who has opened the suggestion list the only
// way back to all appears to be Clear (which empties template and party together). So this value sits
// on the first line of the list: pick it and the field empties, and Apply lifts only the template
// condition (party stays).
//
// Real candidates are `Module:Entity` from the catalog, so they always carry a colon — this value has
// none and cannot collide with them. Putting this one line in the list hides no real template.
export const ALL_TEMPLATES = "All templates";

// Passed as SuggestInput's pinned — typing never filters it out and it stays on the first line. Mixed
// into the plain candidate list it would **disappear while a filter is on** (candidates are filtered
// by the field's value) — which is exactly when the line is needed.
// A module constant because a fresh array on every draw recomputes the list on every render.
export const TEMPLATE_PINNED: readonly string[] = [ALL_TEMPLATES];

// Turns the picked list value into the value of the field — "all" is an empty field. If this string
// landed in the field the server would take it as a template name and nothing would match, so it
// goes back to empty here.
export const pickedTemplate = (value: string): string => (value === ALL_TEMPLATES ? "" : value);
