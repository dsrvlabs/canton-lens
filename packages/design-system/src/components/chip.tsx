// Chips — value notation, copying, badges.
import { type ComponentProps, type ReactNode, useState } from "react";
import { cx } from "./util.ts";

export const Mono = ({ children, className, ...rest }: ComponentProps<"span">): ReactNode => (
  <span className={cx("clds-mono", className)} {...rest}>
    {children}
  </span>
);

// A secondary value — a timestamp, "none", a dash.
export const Muted = ({ children, className, ...rest }: ComponentProps<"span">): ReactNode => (
  <span className={cx("clds-muted", className)} {...rest}>
    {children}
  </span>
);

// An even more secondary value — "and 3 more".
export const Faint = ({ children, className, ...rest }: ComponentProps<"span">): ReactNode => (
  <span className={cx("clds-faint", className)} {...rest}>
    {children}
  </span>
);

// A run where a value and the button that handles it are stuck together as one lump.
// Give href and the whole lump becomes a link (the same rule as Badge).
export const Inline = ({
  href,
  children,
  className,
  ...rest
}: { href?: string } & ComponentProps<"span">): ReactNode =>
  href === undefined ? (
    <span className={cx("clds-inline", className)} {...rest}>
      {children}
    </span>
  ) : (
    <a className={cx("clds-inline", className)} href={href} {...(rest as ComponentProps<"a">)}>
      {children}
    </a>
  );

export const Crumb = ({ children, className, ...rest }: ComponentProps<"p">): ReactNode => (
  <p className={cx("clds-crumb", className)} {...rest}>
    {children}
  </p>
);

// Shows a clipped value without taking the whole away — press it and the original goes to the clipboard.
export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  className,
  ...rest
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
} & Omit<ComponentProps<"button">, "value" | "onClick">): ReactNode {
  const [text, setText] = useState(label);
  return (
    <button
      type="button"
      className={cx("clds-copy", className)}
      title={label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setText(copiedLabel);
          setTimeout(() => setText(label), 900);
        });
      }}
      {...rest}
    >
      {text}
    </button>
  );
}

export type BadgeTone = "neutral" | "solid" | "accent" | "positive" | "negative";

// A one-word fact. **It does not judge** — it only wears the tone the caller decided.
// Give href and the badge itself becomes a link, and the color still follows tone.
export function Badge({
  tone = "neutral",
  shape = "pill",
  mono = false,
  strong = false,
  label = false,
  href,
  children,
  className,
  ...rest
}: {
  tone?: BadgeTone;
  shape?: "pill" | "rounded";
  // a badge holding a value (where a name·id goes)
  mono?: boolean;
  // where the word is itself the judgement (direction·status)
  strong?: boolean;
  // a small scope marker set beside a title
  label?: boolean;
  href?: string;
} & Omit<ComponentProps<"span">, "children"> & { children?: ReactNode }): ReactNode {
  const cls = cx(
    "clds-badge",
    tone !== "neutral" && `clds-badge--${tone}`,
    shape === "rounded" && "clds-badge--rounded",
    mono && "clds-badge--mono",
    strong && "clds-badge--strong",
    label && "clds-badge--label",
    className,
  );
  if (href !== undefined) {
    return (
      <a className={cls} href={href} {...(rest as ComponentProps<"a">)}>
        {children}
      </a>
    );
  }
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}
