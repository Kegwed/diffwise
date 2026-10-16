/** How many of the files a running Review sends to the Model have settled, of how many, as a bar. */
export function ReviewProgress({ settled, total }: { settled: number; total: number }) {
  return (
    <div className="progress" role="progressbar" aria-label="Review progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={settled}>
      <div className="progress-fill" style={{ width: `${total ? (settled / total) * 100 : 0}%` }} />
    </div>
  );
}
