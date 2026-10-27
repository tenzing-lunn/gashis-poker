import type { ReactNode } from "react";
import { cx } from "./cx";

type TxProps = {
  label: ReactNode;
  value: ReactNode;
  gap?: boolean;
  className?: string;
};

/** A two-column record row: label column plus a fixed 22ch value column. */
export function Tx({ label, value, gap, className }: TxProps) {
  return (
    <div className={cx("l tx", gap && "gap", className)}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
