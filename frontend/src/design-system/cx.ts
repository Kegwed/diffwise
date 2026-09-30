/** Joins the truthy class names. */
export const cx = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(" ");
