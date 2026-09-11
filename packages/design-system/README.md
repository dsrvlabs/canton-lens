# @canton-lens/design-system

The design system for Canton Lens. Only **tokens** (CSS variables) and the **domain-free primitives** built from them live here.

## The boundary — what is not here

This package knows nothing about the ledger. The words `party` · `contract` · `lens` · `offset` appear nowhere
in the source, and they never will. Every judgement belongs to `packages/core`,
and the product's vocabulary belongs to `frontend`. Between the two, all this package holds is appearance.

Three signs the boundary is blurring — if any one of them shows, that component belongs in `frontend`:

- a domain word sits in the name (`PartyChip`, `LensMenu`)
- it reads app state such as `useSession`
- it decides "what to show" (a primitive only **wears** — `alert` · `tone` are where the caller's
  already-made judgement arrives, not where the judgement is made)

The runtime dependencies are `react` alone (peer) and the font package `pretendard` (assets only, no code). No UI kit,
no CSS framework, no CDN. If every screen onto a private ledger fired a request at a font CDN, the fact of the
visit would be left outside — so Pretendard is **self-hosted** in the bundle (`fonts.css`, which fetches only the
character ranges actually used out of the 92 dynamic subset slices).

## Using it

Import the stylesheet once at the entry point, and import only the components you need.

```tsx
// main.tsx — the design system comes first
import "@canton-lens/design-system/styles.css";
import "./styles.css"; // the product's own shell layers on top

// in a screen
import { Section, Table, Badge, Muted } from "@canton-lens/design-system";

<Section title="Contracts" note="25 of 214 visible to you" foot="…">
  <Table>
    <tbody>
      <tr>
        <th>Template</th>
        <th>Created</th>
      </tr>
      <tr>
        <td>Iou</td>
        <td>
          <Muted>2026-09-05 11:20:31</Muted>
        </td>
      </tr>
    </tbody>
  </Table>
</Section>;
```

If you only need the tokens, `@canton-lens/design-system/tokens.css`.
If a script or an inline style has to name a color, `token.color.accent` (`src/tokens.ts`) —
the value lives in one place, the CSS, so the two never drift apart in dark mode.

## What is here

| Kind | Exports |
|---|---|
| Layout | `Band` · `Shell` · `SidePanel` · `Columns` · `Scroll` · `LoadingBar` |
| Surface | `Section` · `SectionBody` · `Card` · `CardGrid` · `CardUnavailable` · `ListCard`(`Amount`/`Sub`/`Meta`) · `Banner` |
| Table | `Table` · `RowLink` · `GroupRow` · `MessageRow` |
| List | `DescriptionList` · `Nav` · `NavGroup` · `NavItem` · `NavItemSoon` · `Tabs` · `Tab` · `Anchor` · `Menu`(`Row`/`Aside`/`Empty`) |
| Control | `Button` · `TextInput` · `SuggestInput` · `Toolbar` · `ToolbarForm` · `ToolbarFlag` · `Pager` · `ActionRow` · `SearchBar` · `SearchInput` · `SearchButton` · `FloatingButton` · `RefreshIcon` · `Disclosure` |
| Chip | `Badge` · `Mono` · `Muted` · `Faint` · `Inline` · `Crumb` · `CopyButton` |
| Other | `token` · `NARROW_BREAKPOINT_PX` · `cx` · `truncate` · `activateHandlers` |

## A few rules

**Classes and tokens begin with `clds-`** (`.clds-section`, `--clds-color-accent`). Not `cds-` —
that is IBM Carbon's prefix, and mixed into the same page the tokens get overwritten (this screen may be
delivered embedded inside another console). Element selectors that paint globally live in `src/styles/base.css`
alone; every other file selects elements only inside `.clds-` — the consumer's markup is left untouched.

**Every primitive passes `className` and `ref` straight through.** On React 19 `ref` is an ordinary prop
(`ComponentProps<"…">`). Outside-click detection (`Anchor`) and autofocus (`TextInput`) work off that.

**There are two ways to change the tag, and they mean different things.**
- Give `href` and **the thing itself becomes a link** — `Card` · `Badge` · `Inline`. Color and shape stay as they are.
- `as` changes **only the tag, leaving the meaning** — `Banner as="span"` (a short banner set inside a sentence).
  No other component takes `as`. When one needs it, open it there under the same name.

**Anything that behaves like a row must be reachable by keyboard.** `RowLink` and `ListCard onActivate` attach
`tabIndex=0` · `role="link"` themselves, and the focus ring is the single `:focus-visible` in `base.css`. Where it
goes is not known to this package — the caller decides inside `onActivate`.

**Reaching for a raw class is the escape hatch.** Where the markup is fixed from outside (inside `<td>` · `<dd>`),
attaching a class directly such as `className="clds-mono"` is fine. Once that grows frequent a primitive is
missing, so add it here — `MessageRow` and `Banner as="span"` came about that way.

**The narrow-screen breakpoint is a single 900px.** Media queries cannot read `var()`, so this one number is
written as a literal in several places. To change it, search the whole package for `900px`.

**The palette is the Canton brand plus Etherscan's neutrals.** Black `#1b1b1b` ·
lime `#f6ffa4` · sky blue `#a3cffc` · deep blue `#1c42d4` read off canton.network, and the light/dark
neutrals and success/danger read off the `--bs-*` of etherscan.io. Light's accent is the deep blue, dark's accent is
the sky blue, the band is black in both modes, and on it only the primary button and the single word "Lens" are
lime (`--clds-color-brand`). Lime is not used in body content.

**The theme is chosen with `<html data-theme="light|dark">`.** The design system's default tokens are dark, and
`data-theme="light"` applies the colors and shadows that suit a light background. Explorer starts in light mode
and stores the mode picked with the header's toggle under the `canton-lens-theme` localStorage key.
What is not color — spacing · radii · font sizes — is shared by both modes.


## Build and artifacts

```
pnpm --filter @canton-lens/design-system build
dist/
  index.js · index.d.ts (+ .map)   ← tsc; relative imports are rewritten to .js
  styles.css                       ← the @import chain of src/styles joined into one sheet
  tokens.css
```

`exports` is conditional. **Inside the workspace** the `"source"` condition reads `src/` directly
(`frontend`'s tsconfig `customConditions` and vite `resolve.conditions` turn that condition on) —
type checking runs without a build, and an edit shows up at once. **Outside**, `types`/`import`/`default`
hand over `dist/`. There is no new dependency: tsc and a 30-line script (`scripts/build-css.mjs`) are all of it.
With `sideEffects: ["*.css"]`, components that go unused are dropped by tree shaking.

## On the type-size ramp

This package is `apps/frontend/src/styles.css` lifted across as it was, and the contract of that move was
to **change nothing visible**. So half steps such as 11.5 · 12.5 · 13.5 remain in the ramp — the sizes
actually in use were written down as they are, and the names follow **role** rather than size
(`--clds-text-caption` · `--clds-text-note` · `--clds-text-heading`).

Trimming the ramp changes what is on screen, so it is left to a decision of its own.
