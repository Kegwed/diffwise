import type { ReactNode } from "react";
import { Button } from "./design-system/index.ts";

/**
 * What a card says in place of its list: that there's nothing in it yet, or, with `onRetry`, that it couldn't be loaded,
 * as an alert with a way to try again. `action` is what to do about an empty card.
 */
export function CardMessage({ title, children, action, onRetry }: { title: string; children: ReactNode; action?: ReactNode; onRetry?: () => void }) {
  return (
    <div role={onRetry ? "alert" : undefined} className="card-empty">
      <p className="card-empty-title">{title}</p>
      <p>{children}</p>
      {action}
      {onRetry && <Button onClick={onRetry}>Try again</Button>}
    </div>
  );
}
