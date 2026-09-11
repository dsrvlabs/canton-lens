// Layout — band, shell (side panel + body), two columns, overflow box.
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./util.ts";

// The strip at the very top of the screen. The one place whose lightness is the inverse of the body.
export function Band({ children, className, ...rest }: ComponentProps<"div">): ReactNode {
  return (
    <div className={cx("clds-band", className)} {...rest}>
      <div className="clds-band__inner">{children}</div>
    </div>
  );
}

// The plane under the band. side is <SidePanel>, body is children. main has an id for the skip link (#main).
export function Shell({
  side,
  mainId = "main",
  children,
  className,
  ...rest
}: { side?: ReactNode; mainId?: string } & ComponentProps<"div">): ReactNode {
  return (
    <div className={cx("clds-shell", className)} {...rest}>
      {side}
      <main id={mainId} className="clds-shell__main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

// Reading indicator — an indeterminate progress strip at the foot of the band. Draws nothing unless active.
export function LoadingBar({
  active,
  label = "Loading",
}: {
  active: boolean;
  label?: string;
}): ReactNode {
  if (!active) return null;
  return <div className="clds-loading" role="progressbar" aria-label={label} aria-busy="true" />;
}

// Side panel — a card inside the content, not a pillar outside the page. Narrow screens lay it down as a row.
export function SidePanel({ children, className, ...rest }: ComponentProps<"aside">): ReactNode {
  return (
    <aside className={cx("clds-side", className)} {...rest}>
      {children}
    </aside>
  );
}

// Two columns. ratio is the [left, right] proportion, and on narrow screens it folds into one column.
export function Columns({
  ratio = [1, 1],
  children,
  className,
  style,
  ...rest
}: { ratio?: readonly [number, number] } & ComponentProps<"div">): ReactNode {
  return (
    <div
      className={cx("clds-columns", className)}
      style={{
        ...style,
        ["--clds-columns-left" as string]: `${ratio[0]}fr`,
        ["--clds-columns-right" as string]: `${ratio[1]}fr`,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

// What overflows horizontally scrolls inside its own place — so the document is not pushed side to side.
export function Scroll({ children, className, ...rest }: ComponentProps<"div">): ReactNode {
  return (
    <div className={cx("clds-scroll", className)} {...rest}>
      {children}
    </div>
  );
}
