import { Button } from "@canton-lens/design-system";
import { useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? "light");
  const next = theme === "light" ? "dark" : "light";
  return (
    <Button
      className="theme-toggle"
      variant="outline"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
        if (meta)
          meta.content = getComputedStyle(document.documentElement)
            .getPropertyValue("--clds-color-canvas")
            .trim();
        setTheme(next);
        try {
          localStorage.setItem("canton-lens-theme", next);
        } catch {
          // The switch still works when browser storage is unavailable.
        }
      }}
    >
      {/* Draw the side we are going to. **Only glyphs that render as text** — a color emoji brings its own
        color, so it drifts apart from the monochrome rest of the screen and does not change with the theme.
        `︎` (VARIATION SELECTOR-15) holds ☀ to a text rendering instead of a picture (without it the OS
        draws it as an emoji). ☾ has no emoji presentation, so it needs no selector. Both follow
        currentColor. */}
      <span aria-hidden="true">{next === "light" ? "☀︎" : "☾"}</span>
    </Button>
  );
}
