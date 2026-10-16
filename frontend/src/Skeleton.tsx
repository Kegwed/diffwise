/** A placeholder bar the size of what will load in its place. It pulses, unless motion is reduced. */
export function Skeleton({ width, height }: { width: string | number; height: number }) {
  return <span className="skeleton" style={{ width, height }} />;
}
