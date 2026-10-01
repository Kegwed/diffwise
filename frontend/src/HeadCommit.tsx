/** A head commit as GitHub abbreviates it, with the full hash on hover. */
export function HeadCommit({ commit }: { commit: string }) {
  return <code title={commit}>{commit.slice(0, 7)}</code>;
}
