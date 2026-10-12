import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx.ts";

export interface NoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Names the situation, e.g. "Incomplete coverage". */
  title: ReactNode;
  /** One or two sentences: what it means and what to do. */
  children?: ReactNode;
  /** At most one action, usually a Button. */
  action?: ReactNode;
}

/** A neutral panel telling you something about what you're looking at, with at most one action. */
export function Notice({ title, children, action, className, ...rest }: NoticeProps) {
  return (
    <div {...rest} className={cx("dw-notice", className)}>
      <div className="dw-notice-main">
        <p className="dw-notice-title">{title}</p>
        {children && <div className="dw-notice-text">{children}</div>}
      </div>
      {action}
    </div>
  );
}
