import type { HTMLAttributes } from "react";
import { cx } from "./cx";

type SheetProps = HTMLAttributes<HTMLElement> & {
  as?: "main" | "div" | "section" | "article";
};

/** The document column: numbered lines live inside it. */
export function Sheet({ as: Tag = "main", className, ...rest }: SheetProps) {
  return <Tag className={cx("doc sheet", className)} {...rest} />;
}
