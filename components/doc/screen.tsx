import type { HTMLAttributes } from "react";
import { cx } from "./cx";

type ScreenProps = HTMLAttributes<HTMLElement> & {
  as?: "section" | "div" | "figure";
};

/** A dark band. Tables, replays and live play always sit in one. */
export function Screen({ as: Tag = "section", className, ...rest }: ScreenProps) {
  return <Tag className={cx("screen", className)} {...rest} />;
}
