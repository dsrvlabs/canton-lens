// Lists — name-value lists, nav, dropdown panels.
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./util.ts";

// Name-value. variant="rows" is the detail-screen grammar (fixed-width label column, a rule per row).
export function DescriptionList({
  variant,
  children,
  className,
  ...rest
}: { variant?: "rows" } & ComponentProps<"dl">): ReactNode {
  return (
    <dl className={cx("clds-dl", variant === "rows" && "clds-dl--rows", className)} {...rest}>
      {children}
    </dl>
  );
}

// Carries the block class — the children are clds-nav__item·clds-nav__group, yet the block itself had
// no name, so the rule laying items out horizontally on narrow screens hung on this one <nav>.
export const Nav = ({ children, className, ...rest }: ComponentProps<"nav">): ReactNode => (
  <nav className={cx("clds-nav", className)} {...rest}>
    {children}
  </nav>
);

// A section head in the nav. rule draws a single line above it.
export function NavGroup({
  rule = false,
  children,
  className,
  ...rest
}: { rule?: boolean } & ComponentProps<"div">): ReactNode {
  return (
    <div className={cx("clds-nav__group", rule && "clds-nav__group--rule", className)} {...rest}>
      {children}
    </div>
  );
}

// A nav item. sub is indentation, not collapsing — collapsing is too much when the items are few.
export function NavItem({
  href,
  current = false,
  sub = false,
  children,
  className,
  ...rest
}: { current?: boolean; sub?: boolean } & ComponentProps<"a">): ReactNode {
  return (
    <a
      className={cx("clds-nav__item", sub && "clds-nav__item--sub", className)}
      href={href}
      aria-current={current ? "page" : undefined}
      {...rest}
    >
      {children}
    </a>
  );
}

// A destination that does not exist yet — not a link. Faint, and not pressable.
export function NavItemSoon({
  note,
  children,
  className,
  ...rest
}: { note?: ReactNode } & ComponentProps<"span">): ReactNode {
  return (
    <span
      className={cx("clds-nav__item", "clds-nav__item--soon", className)}
      aria-disabled="true"
      {...rest}
    >
      {children}
      {note === undefined ? null : <small>{note}</small>}
    </span>
  );
}

// Tabs — branches inside one screen. Unlike Nav they are **not somewhere to go but another face of the same
// subject**, so they live under the body head, not in the sidebar. The items are **links**, not buttons
// — which face you are on must live in the address, so that reload·back·link sharing all keep working.
export const Tabs = ({ children, className, ...rest }: ComponentProps<"nav">): ReactNode => (
  <nav className={cx("clds-tabs", className)} {...rest}>
    {children}
  </nav>
);

export function Tab({
  href,
  current = false,
  children,
  className,
  ...rest
}: { current?: boolean } & ComponentProps<"a">): ReactNode {
  return (
    <a
      className={cx("clds-tabs__item", className)}
      href={href}
      aria-current={current ? "page" : undefined}
      {...rest}
    >
      {children}
    </a>
  );
}

// A dropdown's position anchor — wraps opener and panel. The caller holds it by ref to close on outside click.
export function Anchor({ children, className, ...rest }: ComponentProps<"div">): ReactNode {
  return (
    <div className={cx("clds-anchor", className)} {...rest}>
      {children}
    </div>
  );
}

export function Menu({ children, className, ...rest }: ComponentProps<"div">): ReactNode {
  return (
    <div className={cx("clds-menu", className)} {...rest}>
      {children}
    </div>
  );
}

// A row you pick — a radio·checkbox lives inside it. Hence <label> (a press anywhere picks it).
export function MenuRow({
  strong = false,
  children,
  className,
  ...rest
}: { strong?: boolean } & ComponentProps<"label">): ReactNode {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the caller puts the radio·checkbox in as children — this row is its label
    <label
      className={cx("clds-menu__row", strong && "clds-menu__row--strong", className)}
      {...rest}
    >
      {children}
    </label>
  );
}

// Extra information at the right end of a row
export const MenuAside = ({ children, className, ...rest }: ComponentProps<"span">): ReactNode => (
  <span className={cx("clds-menu__aside", className)} {...rest}>
    {children}
  </span>
);

export const MenuEmpty = ({ children, className, ...rest }: ComponentProps<"p">): ReactNode => (
  <p className={cx("clds-menu__empty", className)} {...rest}>
    {children}
  </p>
);
