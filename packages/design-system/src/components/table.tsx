// Table — the vessel and "the whole row is a link", nothing else. A cell's meaning is the caller's to set.
import type { ComponentProps, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { activateHandlers, cx } from "./util.ts";

export function Table({
  variant,
  children,
  className,
  ...rest
}: {
  // fields: a narrow table whose width follows its content (field name·type·value). loose: roomy cells.
  variant?: "fields" | "loose";
} & ComponentProps<"table">): ReactNode {
  return (
    <table
      className={cx("clds-table", variant !== undefined && `clds-table--${variant}`, className)}
      {...rest}
    >
      {children}
    </table>
  );
}

// A row that goes to one place wherever you press it. **Where it goes is not known to this package** —
// the caller decides inside onActivate (by changing the address, or by changing state).
// Enter means something only if the row is keyboard-reachable (tabIndex); role says "link" to assistive tech.
export function RowLink({
  onActivate,
  children,
  className,
  ...rest
}: { onActivate: () => void } & ComponentProps<"tr">): ReactNode {
  const h = activateHandlers(onActivate);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a table row cannot be an <a> (links·buttons live inside) — role says the row is a link
    <tr
      className={cx("clds-rowlink", className)}
      tabIndex={0}
      role="link"
      onClick={(event: MouseEvent<HTMLTableRowElement>) => h.onClick(event)}
      onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => h.onKeyDown(event)}
      {...rest}
    >
      {children}
    </tr>
  );
}

// A line stating the circumstance instead of a value — "none" (muted) and "could not read" (problem) differ.
// A table is never left empty: an empty table says nothing at all.
export function MessageRow({
  tone = "muted",
  colSpan,
  children,
}: {
  tone?: "muted" | "problem";
  colSpan?: number;
  children: ReactNode;
}): ReactNode {
  return (
    <tr>
      <td className={tone === "problem" ? "clds-banner" : "clds-muted"} colSpan={colSpan}>
        {children}
      </td>
    </tr>
  );
}

// A group head row inside a table — says what the rows beneath it are bound by.
export function GroupRow({ children, className, ...rest }: ComponentProps<"tr">): ReactNode {
  return (
    <tr className={cx("clds-grouphead", className)} {...rest}>
      {children}
    </tr>
  );
}
