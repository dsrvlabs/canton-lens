// Surfaces — sections, summary cards, list cards, banners.
import type { ComponentProps, ReactNode } from "react";
import { activateHandlers, cx } from "./util.ts";

export function Section({
  title,
  subtitle,
  note,
  foot,
  children,
  className,
  ...rest
}: {
  // to leave the head out entirely, give no title.
  title?: ReactNode;
  // a word set right after the title ("awaiting you")
  subtitle?: ReactNode;
  // a word pushed to the right end of the head ("latest 6 of 214")
  note?: ReactNode;
  foot?: ReactNode;
  // title collides in name with <section title> — here it is the section's heading, not a tooltip.
} & Omit<ComponentProps<"section">, "title">): ReactNode {
  return (
    <section className={cx("clds-section", className)} {...rest}>
      {title === undefined ? null : (
        <h2 className="clds-section__head">
          {title}
          {subtitle === undefined ? null : (
            <span className="clds-section__subtitle">{subtitle}</span>
          )}
          <span className="clds-section__spacer" />
          {note === undefined ? null : <span className="clds-section__note">{note}</span>}
        </h2>
      )}
      {children}
      {foot === undefined ? null : <div className="clds-section__foot">{foot}</div>}
    </section>
  );
}

// The padded body inside a section. A table does not use this — a table holds its padding in its own cells.
export function SectionBody({ children, className, ...rest }: ComponentProps<"div">): ReactNode {
  return (
    <div className={cx("clds-section__body", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardGrid({ children, className, ...rest }: ComponentProps<"div">): ReactNode {
  return (
    <div className={cx("clds-card-grid", className)} {...rest}>
      {children}
    </div>
  );
}

// Summary card — label · number · one-line note. Give href and the whole of it becomes a link.
// alert is **not a judgement**: it only wears the judgement the caller already made.
export function Card({
  label,
  value,
  unit,
  sub,
  href,
  alert = false,
  valueClassName,
  valueTitle,
  children,
  className,
  ...rest
}: {
  label: ReactNode;
  // a card with a value takes value; one stating the circumstance instead takes children (=<CardUnavailable>)
  value?: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  href?: string;
  alert?: boolean;
  valueClassName?: string;
  valueTitle?: string;
} & Omit<ComponentProps<"div">, "title">): ReactNode {
  const body = (
    <>
      <div className="clds-card__label">
        <span>{label}</span>
        {/* The "this goes somewhere" mark — only on cards you can press. It is a character (↗), not an
          image, so neither files nor fonts grow. Hidden from reading programs: the destination is spoken
          by the link itself, and this glyph only repeats it. */}
        {href === undefined ? null : (
          <span className="clds-card__go" aria-hidden="true">
            ↗
          </span>
        )}
      </div>
      {/* Value and note stand side by side at the **foot** of the card — label above, value below. Even
        when cards differ in height, the numbers read off the same line. */}
      <div className="clds-card__foot">
        {children ?? (
          <>
            <div className={cx("clds-card__value", valueClassName)} title={valueTitle}>
              {value}
              {unit === undefined ? null : <span className="clds-card__unit">{unit}</span>}
            </div>
            {sub === undefined ? null : (
              <div className="clds-card__sub" title={typeof sub === "string" ? sub : undefined}>
                {sub}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
  const cls = cx("clds-card", alert && "clds-card--alert", className);
  if (href !== undefined) {
    return (
      <a className={cls} href={href}>
        {body}
      </a>
    );
  }
  return (
    <div className={cls} {...rest}>
      {body}
    </div>
  );
}

// When one card slot is "could not fetch" — it says that circumstance, not 0.
export function CardUnavailable({ children }: { children: ReactNode }): ReactNode {
  return (
    <>
      <div className="clds-card__value">
        <span className="clds-muted">–</span>
      </div>
      <div className="clds-card__sub">{children}</div>
    </>
  );
}

// List card — a sheet stacked vertically inside a section. For when a table row cannot hold enough.
// Give onActivate and the whole sheet becomes a link by the same rule as RowLink (keyboard reach and role).
export function ListCard({
  alert = false,
  onActivate,
  children,
  className,
  ...rest
}: { alert?: boolean; onActivate?: () => void } & ComponentProps<"div">): ReactNode {
  const link = onActivate === undefined ? null : activateHandlers(onActivate);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: role="link" and tabIndex are attached together only when a handler exists — it is not a static element
    <div
      className={cx(
        "clds-listcard",
        alert && "clds-listcard--alert",
        link !== null && "clds-listcard--link",
        className,
      )}
      tabIndex={link === null ? undefined : 0}
      role={link === null ? undefined : "link"}
      onClick={link === null ? undefined : (event) => link.onClick(event)}
      onKeyDown={link === null ? undefined : (event) => link.onKeyDown(event)}
      {...rest}
    >
      {children}
    </div>
  );
}

export const ListCardAmount = ({
  children,
  className,
  ...rest
}: ComponentProps<"span">): ReactNode => (
  <span className={cx("clds-listcard__amount", className)} {...rest}>
    {children}
  </span>
);

export const ListCardSub = ({ children, className, ...rest }: ComponentProps<"div">): ReactNode => (
  <div className={cx("clds-listcard__sub", className)} {...rest}>
    {children}
  </div>
);

export const ListCardMeta = ({
  children,
  className,
  ...rest
}: ComponentProps<"span">): ReactNode => (
  <span className={cx("clds-listcard__meta", className)} {...rest}>
    {children}
  </span>
);

// Banner — one line that states the circumstance. It gives no margin: where it stands decides the margin.
// as="span" is there for a short banner set inside a sentence ("Could not read").
export function Banner({
  tone = "problem",
  as: Tag = "p",
  children,
  className,
  ...rest
}: {
  tone?: "problem" | "info";
  as?: "p" | "div" | "span";
} & ComponentProps<"p">): ReactNode {
  return (
    <Tag className={cx("clds-banner", tone === "info" && "clds-banner--info", className)} {...rest}>
      {children}
    </Tag>
  );
}
