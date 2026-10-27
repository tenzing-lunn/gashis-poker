import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

type TextButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Toggle state, exposed as `aria-pressed`. Omit for a plain action. */
  pressed?: boolean;
};

/** Bare text button for transport and toggles: `[PAUSE]`, `4x`. */
export function TextButton({ pressed, className, type = "button", ...rest }: TextButtonProps) {
  return <button type={type} aria-pressed={pressed} className={cx("t", className)} {...rest} />;
}

type BoxCommon = { filled?: boolean };
type BoxAsButton = BoxCommon & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type BoxAsLink = BoxCommon & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string };

/** Boxed primary action. `filled` is inverted at rest. With `href` it renders a link. */
export function BoxButton(props: BoxAsButton | BoxAsLink) {
  if (props.href !== undefined) {
    const { filled, className, href, ...rest } = props;
    return <Link href={href} className={cx("apply", filled && "cta", className)} {...rest} />;
  }
  const { filled, className, type = "button", ...rest } = props;
  return <button type={type} className={cx("apply", filled && "cta", className)} {...rest} />;
}
