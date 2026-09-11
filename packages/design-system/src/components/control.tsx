// Controls — buttons, inputs, toolbars, paging, search, disclosure.
import {
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { cx } from "./util.ts";

export type ButtonVariant = "primary" | "secondary" | "outline" | "plain";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "xl";

// The default is secondary/sm — a button in the toolbar above a list is the most common place.
// plain is a text-only button, so it takes no size.
export function Button({
  variant = "secondary",
  size = "sm",
  type = "button",
  children,
  className,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
} & ComponentProps<"button">): ReactNode {
  return (
    <button
      type={type}
      className={cx(
        "clds-button",
        `clds-button--${variant}`,
        variant !== "plain" && `clds-button--${size}`,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function TextInput({
  size = "sm",
  block = false,
  mono = false,
  wide = false,
  narrow = false,
  type = "text",
  className,
  ...rest
}: {
  size?: "sm" | "md";
  block?: boolean;
  mono?: boolean;
  wide?: boolean;
  // a field taking a value of a few characters (one number) — the default width eats too much of a toolbar
  narrow?: boolean;
  // size collides in name with <input size> — we cover the HTML one and use it in our sense (size grade)
} & Omit<ComponentProps<"input">, "size">): ReactNode {
  return (
    <input
      type={type}
      className={cx(
        "clds-input",
        `clds-input--${size}`,
        block && "clds-input--block",
        mono && "clds-input--mono",
        wide && "clds-input--wide",
        narrow && "clds-input--narrow",
        className,
      )}
      {...rest}
    />
  );
}

// An input with a suggestion list — it stands in for the browser's datalist. The datalist popup is drawn by
// the browser, so neither its place nor its height could be set (it ran far off screen). Here the list opens
// **directly under the input, left aligned** and scrolls past a height of 500px (.clds-suggest__menu).
// · options is a list of strings — this component does not know what they name. Duplicates are stripped.
// · Filtering is "contains" (case insensitive). Empty shows everything.
// · Picking calls onPick(value). The input itself is held by the caller with value/onChange (as TextInput).
// · Keyboard: ↓↑ move, Enter picks (with nothing picked, Enter goes on to the form), Esc closes.
// · The marker (▾) is only a picture — pressing it moves focus to the input (no pointer-events).
// Building a new array for the default each render re-runs the list below every render — share one empty one.
const NONE_PINNED: readonly string[] = [];

export function SuggestInput({
  options,
  pinned = NONE_PINNED,
  onPick,
  value,
  onChange,
  onKeyDown,
  onFocus,
  onBlur,
  className,
  ...rest
}: {
  options: readonly string[];
  // Items that typing never filters out and that **always stay on the first line**. This is the place for a
  // choice that lifts the narrowing rather than narrows the list, like "All" — a value in the input filters
  // the candidates by it, so it vanishes just when needed. Pass a module constant from the call site (a new
  // array on every render recomputes the list every time).
  pinned?: readonly string[];
  onPick: (value: string) => void;
} & Omit<ComponentProps<typeof TextInput>, "list">): ReactNode {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const menuRef = useRef<HTMLDivElement>(null);
  const query = String(value ?? "");
  const shown = useMemo(() => {
    const uniq = Array.from(new Set(options)).filter((o) => !pinned.includes(o));
    const q = query.trim().toLowerCase();
    return [...pinned, ...(q === "" ? uniq : uniq.filter((o) => o.toLowerCase().includes(q)))];
  }, [options, pinned, query]);
  // scroll so the active row comes into view
  useEffect(() => {
    if (!open || active < 0) return;
    menuRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  const pick = (v: string) => {
    onPick(v);
    setOpen(false);
    setActive(-1);
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (shown.length === 0 ? -1 : (i + 1) % shown.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (shown.length === 0 ? -1 : (i <= 0 ? shown.length : i) - 1));
    } else if (e.key === "Enter" && open && active >= 0 && shown[active] !== undefined) {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  };
  const visible = open && shown.length > 0;
  return (
    <span className={cx("clds-suggest", className)}>
      <TextInput
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={visible && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          setOpen(true);
          setActive(-1);
          onChange?.(e);
        }}
        onFocus={(e) => {
          setOpen(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setOpen(false);
          setActive(-1);
          onBlur?.(e);
        }}
        onKeyDown={keys}
        {...rest}
      />
      {/* The list is a div (not ul/li) — the listbox/option roles carry the meaning, and rows are for the
          mouse, so they take no focus (-1). The keyboard is taken by the input (↓↑ Enter Esc). */}
      <div
        id={listId}
        role="listbox"
        ref={menuRef}
        className="clds-menu clds-suggest__menu"
        hidden={!visible}
      >
        {shown.map((o, i) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard is taken by the input (↓↑ Enter) — rows are for the mouse
          <div
            key={o}
            id={`${listId}-${i}`}
            role="option"
            tabIndex={-1}
            aria-selected={i === active}
            className="clds-suggest__opt"
            // comes before blur — preventing the default keeps focus in the input and lets click land
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(o)}
            onMouseEnter={() => setActive(i)}
          >
            {o}
          </div>
        ))}
      </div>
    </span>
  );
}

// The row standing between a section's head and its body. No judgement here — it takes input and passes it on.
export const Toolbar = ({ children, className, ...rest }: ComponentProps<"div">): ReactNode => (
  <div className={cx("clds-toolbar", className)} {...rest}>
    {children}
  </div>
);

// When the toolbar is itself a form — a filter row applied with Enter. It looks the same as Toolbar.
export const ToolbarForm = ({
  children,
  className,
  ...rest
}: ComponentProps<"form">): ReactNode => (
  <form className={cx("clds-toolbar", className)} {...rest}>
    {children}
  </form>
);

// A pill that states a condition that is on
export const ToolbarFlag = ({
  children,
  className,
  ...rest
}: ComponentProps<"span">): ReactNode => (
  <span className={cx("clds-toolbar__flag", className)} {...rest}>
    {children}
  </span>
);

// The button row applying what was picked — it stands the same at a menu's foot and under a list on screen.
export const ActionRow = ({ children, className, ...rest }: ComponentProps<"div">): ReactNode => (
  <div className={cx("clds-actions", className)} {...rest}>
    {children}
  </div>
);

export const Pager = ({ children, className, ...rest }: ComponentProps<"div">): ReactNode => (
  <div className={cx("clds-pager", className)} {...rest}>
    {children}
  </div>
);

// Search row — no magnifier icon. The placeholder text says what goes in.
export const SearchBar = ({ children, className, ...rest }: ComponentProps<"div">): ReactNode => (
  <div className={cx("clds-searchbar", className)} {...rest}>
    {children}
  </div>
);

export const SearchInput = ({
  className,
  type = "text",
  ...rest
}: ComponentProps<"input">): ReactNode => (
  <input type={type} className={cx("clds-searchbar__input", className)} {...rest} />
);

// The search row's run button — a magnifier. One of the few places where a picture stands in for a word:
// on a row this dense the glyph reads faster than the word. A picture has no name, so aria-label and title
// still say "Search". Inline SVG — no icon library.
export function SearchButton({
  label = "Search",
  className,
  type = "button",
  ...rest
}: { label?: string } & ComponentProps<"button">): ReactNode {
  return (
    <button
      type={type}
      className={cx("clds-searchbar__button", className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <path d="M15.5 15.5 L21 21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </button>
  );
}

// A floating round button — one action pinned to the bottom right of the screen. A picture stands in for a
// word here on the same grounds as the search button: it is in the same spot on every screen, so one
// picture reads, and the word is said by aria-label·title.
// While busy it cannot be pressed and the picture spins (.clds-fab--busy).
export function FloatingButton({
  label,
  busy = false,
  className,
  type = "button",
  children,
  ...rest
}: { label: string; busy?: boolean } & ComponentProps<"button">): ReactNode {
  return (
    <button
      type={type}
      className={cx("clds-fab", busy && "clds-fab--busy", className)}
      aria-label={label}
      title={label}
      aria-busy={busy || undefined}
      disabled={busy || rest.disabled}
      {...rest}
    >
      {children}
    </button>
  );
}

// The refresh picture (bold.svg, 24×24) — the color is currentColor.
export function RefreshIcon({ size = 24 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g fill="currentColor">
        <path d="M17.5996 4C17.5996 3.50294 18.0029 3.09961 18.5 3.09961C18.9971 3.09961 19.4004 3.50294 19.4004 4V8C19.4004 8.49706 18.9971 8.90039 18.5 8.90039H14.5C14.0029 8.90039 13.5996 8.49706 13.5996 8C13.5996 7.50294 14.0029 7.09961 14.5 7.09961H17.5996V4Z" />
        <path d="M3.59961 12C3.59961 7.36081 7.36081 3.59961 12 3.59961C14.8985 3.59961 17.4535 5.06909 18.9619 7.29883C19.2402 7.71047 19.1322 8.26935 18.7207 8.54785C18.309 8.82636 17.7492 8.71834 17.4707 8.30664C16.2828 6.55096 14.2757 5.40039 12 5.40039C8.35492 5.40039 5.40039 8.35492 5.40039 12C5.40039 12.4971 4.99706 12.9004 4.5 12.9004C4.00294 12.9004 3.59961 12.4971 3.59961 12Z" />
        <path d="M6.40039 19.5C6.40039 19.9971 5.99706 20.4004 5.5 20.4004C5.00294 20.4004 4.59961 19.9971 4.59961 19.5V15.5C4.59961 15.0029 5.00294 14.5996 5.5 14.5996H9.5C9.99706 14.5996 10.4004 15.0029 10.4004 15.5C10.4004 15.9971 9.99706 16.4004 9.5 16.4004H6.40039V19.5Z" />
        <path d="M20.4004 11.5C20.4004 16.1392 16.6392 19.9004 12 19.9004C9.10154 19.9004 6.54648 18.4309 5.03809 16.2012C4.75976 15.7895 4.86776 15.2306 5.2793 14.9521C5.691 14.6736 6.25079 14.7817 6.5293 15.1934C7.71722 16.949 9.72434 18.0996 12 18.0996C15.6451 18.0996 18.5996 15.1451 18.5996 11.5C18.5996 11.0029 19.0029 10.5996 19.5 10.5996C19.9971 10.5996 20.4004 11.0029 20.4004 11.5Z" />
      </g>
    </svg>
  );
}

// Disclosure — where the original is kept hidden away. Open it and the value comes out as it is.
export function Disclosure({
  summary,
  children,
  className,
  ...rest
}: { summary: ReactNode } & ComponentProps<"details">): ReactNode {
  return (
    <details className={cx("clds-disclosure", className)} {...rest}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
