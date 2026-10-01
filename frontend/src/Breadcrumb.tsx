import { Fragment } from "react";

/** The way back up from a view: each view above it as a link, then the view itself. */
export function Breadcrumb({ above, current }: { above: { label: string; href: string }[]; current: string }) {
  return (
    <nav aria-label="Breadcrumb" className="breadcrumb caption">
      {above.map(({ label, href }) => (
        <Fragment key={href}>
          <a href={href}>{label}</a>
          <span aria-hidden="true">/</span>
        </Fragment>
      ))}
      <span aria-current="page">{current}</span>
    </nav>
  );
}
