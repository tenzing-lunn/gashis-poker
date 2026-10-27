import { useId, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode;
  /** Shown as a warn tag on the next line and linked via aria-describedby. */
  error?: ReactNode;
};

/** CAPS label left, underlined input right. */
export function Field({ label, error, className, ...rest }: FieldProps) {
  const errorId = useId();
  return (
    <>
      <label className={cx("l field", className)}>
        <span>{label}</span>
        <input
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          {...rest}
        />
      </label>
      {error ? (
        <div className="l field">
          <span />
          <span>
            <span id={errorId} className="tag">
              {error}
            </span>
          </span>
        </div>
      ) : null}
    </>
  );
}

type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  type?: "radio" | "checkbox";
  children: ReactNode;
};

/** ASCII radio `( )` / `(X)` or checkbox `[ ]` / `[X]` over a hidden native input. */
export function Choice({ type = "radio", children, className, ...rest }: ChoiceProps) {
  return (
    <label className={cx("opt", className)}>
      <input type={type} {...rest} />
      <span className="box" aria-hidden="true" />
      <span>{children}</span>
    </label>
  );
}

/** Highlight tag on `--warn`: `YOUR TURN`, form errors. */
export function Tag({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx("tag", className)} {...rest} />;
}
