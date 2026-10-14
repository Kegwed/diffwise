import { useId, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx.ts";

export interface MenuProps extends HTMLAttributes<HTMLDivElement> {
  /** What the menu chooses, for screen readers, e.g. "Choose a Model for this Review". */
  label: string;
  children?: ReactNode;
}

/**
 * A floating list of choices that drops down from a Button, with its choices in groups. The consumer provides the
 * groups, items, selection and open state, and gives the Button that opens it `aria-haspopup` and `aria-expanded`.
 */
export function Menu({ label, className, children, ...rest }: MenuProps) {
  return (
    <div {...rest} role="group" aria-label={label} className={cx("dw-menu", className)}>
      {children}
    </div>
  );
}

export interface MenuGroupProps {
  /** The group's name, e.g. a Model Provider. */
  label: ReactNode;
  /** Shown at the end of the group's heading, e.g. its ConnectionStatus. */
  aside?: ReactNode;
  /** Why the group can't be used, shown in place of its items. */
  note?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** One group of a Menu's choices, named by its label. */
export function MenuGroup({ label, aside, note, children, className }: MenuGroupProps) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className={cx("dw-menu-group", className)}>
      <div className="dw-menu-head">
        <span id={labelId} className="dw-menu-label">
          {label}
        </span>
        {aside}
      </div>
      {note && <p className="dw-menu-note">{note}</p>}
      {children}
    </div>
  );
}

export interface MenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The current choice: accent-soft behind, an accent check. */
  selected?: boolean;
}

/** One choice in a Menu. */
export function MenuItem({ selected = false, className, children, ...rest }: MenuItemProps) {
  return (
    <button {...rest} type="button" aria-pressed={selected} className={cx("dw-menu-item", className)}>
      <span>{children}</span>
      {selected && (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      )}
    </button>
  );
}
