import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx.ts";

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Says what's missing: "No Reviews yet", "Couldn't load Reviews". */
  title: ReactNode;
  /** One or two sentences: what will appear here, or why it couldn't be loaded and what to check. */
  children?: ReactNode;
  /** At most one action: a Button, or a Button with `href`. */
  action?: ReactNode;
}

/** What a card says in place of its list: nothing there yet, or why it couldn't be loaded (pass `role="alert"`). */
export function EmptyState({ title, children, action, className, ...rest }: EmptyStateProps) {
  return (
    <div {...rest} className={cx("dw-empty", className)}>
      <p className="dw-empty-title">{title}</p>
      {children && <div className="dw-empty-text">{children}</div>}
      {action}
    </div>
  );
}
