import type { ElementType, HTMLAttributes } from "react";
import { cx } from "./cx";

export type LineProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  /** Center the content (section titles such as `FIG. 1: TABLE`). */
  center?: boolean;
  /** Add the half-line spacing step above this line. */
  gap?: boolean;
};

/** One numbered line. Children are laid out label-left, value-right. */
export function Line({ as: Tag = "div", center, gap, className, ...rest }: LineProps) {
  return <Tag className={cx("l", center && "c", gap && "gap", className)} {...rest} />;
}

/** An empty numbered line, used for vertical rhythm. */
export function Blank() {
  return <div className="l" />;
}

const EQUALS = "=".repeat(240);

/** A full-width `====` rule between major sections. */
export function Rule() {
  return (
    <div className="l rule" role="separator">
      <span aria-hidden="true">{EQUALS}</span>
    </div>
  );
}

/** A muted line explaining a figure's symbols. */
export function Legend({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("l legend", className)} {...rest} />;
}
