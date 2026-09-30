// Reading a unified diff patch, as GitHub reports it. The backend numbers lines for the Model with it and the
// frontend draws diffs with it, so a Finding's lines mean the same thing to both.

export interface DiffLine {
  type: "added" | "removed" | "context";
  /** Line number in the old version of the file; removed and context lines only. */
  oldLine?: number;
  /** Line number in the new version of the file; added and context lines only. */
  newLine?: number;
  /** The line's content, without its +, - or space marker. */
  text: string;
}

export interface DiffHunk {
  /** The hunk's `@@ -a,b +c,d @@` line, as the patch has it. */
  header: string;
  lines: DiffLine[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export const DIFF_MARKERS: Record<DiffLine["type"], string> = { added: "+", removed: "-", context: " " };

/**
 * Splits a patch into hunks of numbered lines. Each hunk takes only as many lines as its header counts, so a
 * trailing newline adds no line. "\ No newline at end of file" markers are dropped.
 */
export function parsePatch(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let oldLine = 0;
  let newLine = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const line of patch.split(/\r?\n/)) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      oldLeft = Number(header[2] ?? 1);
      newLine = Number(header[3]);
      newLeft = Number(header[4] ?? 1);
      hunks.push({ header: line, lines: [] });
      continue;
    }
    const hunk = hunks.at(-1);
    if (!hunk || line.startsWith("\\")) continue;
    if (line.startsWith("+") && newLeft > 0) {
      newLeft--;
      hunk.lines.push({ type: "added", newLine: newLine++, text: line.slice(1) });
    } else if (line.startsWith("-") && oldLeft > 0) {
      oldLeft--;
      hunk.lines.push({ type: "removed", oldLine: oldLine++, text: line.slice(1) });
    } else if (oldLeft > 0 && newLeft > 0) {
      oldLeft--;
      newLeft--;
      hunk.lines.push({ type: "context", oldLine: oldLine++, newLine: newLine++, text: line.slice(1) });
    }
  }
  return hunks;
}
