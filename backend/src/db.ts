import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { OLLAMA } from "./model-provider-config.ts";
import type { FileOutcome, Finding, FindingKind, PullRequestRef, Review, Severity } from "@diffwise/shared";

export type Database = DatabaseSync;

/** Opens (and migrates) the SQLite database at `path`; use ":memory:" for tests. */
export function openDatabase(path: string): Database {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      number INTEGER NOT NULL,
      head_commit TEXT NOT NULL,
      model_provider TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS findings (
      review_id TEXT NOT NULL REFERENCES reviews(id),
      position INTEGER NOT NULL,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      file TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      title TEXT NOT NULL,
      explanation TEXT NOT NULL,
      suggested_fix TEXT,
      security_reference TEXT,
      PRIMARY KEY (review_id, position)
    );
    CREATE TABLE IF NOT EXISTS file_outcomes (
      review_id TEXT NOT NULL REFERENCES reviews(id),
      position INTEGER NOT NULL,
      file TEXT NOT NULL,
      outcome TEXT NOT NULL,
      reason TEXT,
      patch TEXT,
      PRIMARY KEY (review_id, position)
    );
  `);
  // Reviews saved before Model Providers were configurable all ran on the Ollama preset.
  addColumnIfMissing(db, "reviews", "model_provider", `TEXT NOT NULL DEFAULT '${OLLAMA}'`);
  // Reviews saved before patches were kept show their Findings without a diff.
  addColumnIfMissing(db, "file_outcomes", "patch", "TEXT");
  // Reviews saved before Pull Request titles were kept are shown by the Pull Request's number instead.
  addColumnIfMissing(db, "reviews", "pull_request_title", "TEXT");
  return db;
}

function addColumnIfMissing(db: Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
  if (!columns.some(({ name }) => name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/** Saves a complete Review. */
export function saveReview(db: Database, review: Review): void {
  const insertReview = db.prepare(
    `INSERT INTO reviews (id, owner, repo, number, pull_request_title, head_commit, model_provider, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertFinding = db.prepare(
    `INSERT INTO findings (review_id, position, kind, severity, file, start_line, end_line, title, explanation, suggested_fix, security_reference)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertFileOutcome = db.prepare(
    "INSERT INTO file_outcomes (review_id, position, file, outcome, reason, patch) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const { owner, repo, number } = review.pullRequest;
  db.exec("BEGIN");
  try {
    insertReview.run(
      review.id,
      owner,
      repo,
      number,
      review.pullRequestTitle ?? null,
      review.headCommit,
      review.modelProvider,
      review.model,
      review.createdAt,
    );
    review.fileOutcomes.forEach((o, position) => {
      const [reason, patch] = o.outcome === "reviewed" ? [null, o.patch] : [o.reason, null];
      insertFileOutcome.run(review.id, position, o.file, o.outcome, reason, patch);
    });
    review.findings.forEach((f, position) => {
      insertFinding.run(
        review.id,
        position,
        f.kind,
        f.severity,
        f.file,
        f.startLine,
        f.endLine,
        f.title,
        f.explanation,
        f.suggestedFix ?? null,
        f.securityReference ?? null,
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

interface ReviewRow {
  id: string;
  owner: string;
  repo: string;
  number: number;
  pull_request_title: string | null;
  head_commit: string;
  model_provider: string;
  model: string;
  created_at: string;
}

interface FileOutcomeRow {
  file: string;
  outcome: FileOutcome["outcome"];
  reason: string | null;
  patch: string | null;
}

interface FindingRow {
  kind: FindingKind;
  severity: Severity;
  file: string;
  start_line: number;
  end_line: number;
  title: string;
  explanation: string;
  suggested_fix: string | null;
  security_reference: string | null;
}

export function getReview(db: Database, id: string): Review | undefined {
  const row = db.prepare("SELECT * FROM reviews WHERE id = ?").get(id) as ReviewRow | undefined;
  if (!row) return undefined;
  const fileOutcomeRows = db
    .prepare("SELECT * FROM file_outcomes WHERE review_id = ? ORDER BY position")
    .all(id) as unknown as FileOutcomeRow[];
  const findingRows = db
    .prepare("SELECT * FROM findings WHERE review_id = ? ORDER BY position")
    .all(id) as unknown as FindingRow[];
  return {
    id: row.id,
    ...pullRequestOf(row),
    headCommit: row.head_commit,
    modelProvider: row.model_provider,
    model: row.model,
    createdAt: row.created_at,
    // Only complete Reviews are saved.
    status: "complete",
    fileOutcomes: fileOutcomeRows.map(toFileOutcome),
    pendingFiles: [],
    findings: findingRows.map(toFinding),
  };
}

/** A Review as a list of Reviews needs it: no File Outcomes, and only the kind and Severity of each Finding. */
export type ListedReview = Pick<
  Review,
  "id" | "pullRequest" | "pullRequestTitle" | "modelProvider" | "model" | "headCommit" | "createdAt" | "status"
> & {
  findings: Pick<Finding, "kind" | "severity">[];
};

/** The Pull Request's saved Reviews, newest first. Whether each is Outdated isn't saved, so it's left to the caller. */
export function listReviews(db: Database, { owner, repo, number }: PullRequestRef): ListedReview[] {
  return listSaved(db, "WHERE owner = ? AND repo = ? AND number = ?", [owner, repo, number]);
}

/** The newest `limit` saved Reviews, of any Pull Request, newest first. */
export function listRecentReviews(db: Database, limit: number): ListedReview[] {
  return listSaved(db, "", [], limit);
}

/** The saved Reviews `where` picks, newest first, at most `limit` of them. */
function listSaved(db: Database, where: string, params: SQLInputValue[], limit = -1): ListedReview[] {
  const rows = db
    .prepare(`SELECT * FROM reviews ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(...params, limit) as unknown as ReviewRow[];
  const ids = rows.map((row) => row.id);
  const findingRows = db
    .prepare(
      `SELECT review_id, kind, severity FROM findings WHERE review_id IN (SELECT value FROM json_each(?)) ORDER BY position`,
    )
    .all(JSON.stringify(ids)) as unknown as ({ review_id: string } & ListedReview["findings"][number])[];
  const findings = Map.groupBy(findingRows, (finding) => finding.review_id);
  return rows.map((row) => ({
    id: row.id,
    ...pullRequestOf(row),
    modelProvider: row.model_provider,
    model: row.model,
    headCommit: row.head_commit,
    createdAt: row.created_at,
    // Only complete Reviews are saved.
    status: "complete",
    findings: (findings.get(row.id) ?? []).map(({ kind, severity }) => ({ kind, severity })),
  }));
}

/** The Pull Request a saved Review is of, with its title if it was saved with one. */
function pullRequestOf(row: ReviewRow): Pick<Review, "pullRequest" | "pullRequestTitle"> {
  return {
    pullRequest: { owner: row.owner, repo: row.repo, number: row.number },
    ...(row.pull_request_title !== null && { pullRequestTitle: row.pull_request_title }),
  };
}

function toFileOutcome(row: FileOutcomeRow): FileOutcome {
  return row.outcome === "reviewed"
    ? { file: row.file, outcome: row.outcome, patch: row.patch ?? "" }
    : { file: row.file, outcome: row.outcome, reason: row.reason ?? "" };
}

function toFinding(row: FindingRow): Finding {
  return {
    kind: row.kind,
    severity: row.severity,
    file: row.file,
    startLine: row.start_line,
    endLine: row.end_line,
    title: row.title,
    explanation: row.explanation,
    ...(row.suggested_fix !== null && { suggestedFix: row.suggested_fix }),
    ...(row.security_reference !== null && { securityReference: row.security_reference }),
  };
}
