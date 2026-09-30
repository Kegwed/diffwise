import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx.ts";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: the one action the view is for (at most one per view). secondary: the default. ghost: low-stakes, reversible actions. */
  variant?: "primary" | "secondary" | "ghost";
  /** md (32px) in page toolbars; sm (28px) inside cards and list rows. */
  size?: "md" | "sm";
}

export function Button({ variant = "secondary", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return <button {...rest} type={type} className={cx("dw-btn", `dw-btn-${variant}`, `dw-btn-${size}`, className)} />;
}
