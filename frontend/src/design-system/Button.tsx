import type { ComponentPropsWithRef } from "react";
import { cx } from "./cx.ts";

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  /** primary: the one action the view is for (at most one per view). secondary: the default. ghost: low-stakes, reversible actions. */
  variant?: "primary" | "secondary" | "ghost";
  /** md (32px) in page toolbars; sm (28px) inside cards and list rows. With `aria-pressed`, an sm secondary button is a toggle, as a filter is. */
  size?: "md" | "sm";
  /** Makes it a link that looks like a Button: for going somewhere (another page, GitHub), never for an action. */
  href?: string;
}

export function Button({ variant = "secondary", size = "md", className, type = "button", href, children, ...rest }: ButtonProps) {
  const classes = cx("dw-btn", `dw-btn-${variant}`, `dw-btn-${size}`, className);
  if (href !== undefined) {
    // A link stays a link to assistive technology: only its look is a Button's.
    return (
      <a href={href} className={classes} aria-label={rest["aria-label"]}>
        {children}
      </a>
    );
  }
  return (
    <button {...rest} type={type} className={classes}>
      {children}
    </button>
  );
}
