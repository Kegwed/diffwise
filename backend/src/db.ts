import { DatabaseSync } from "node:sqlite";
import type { Finding, FindingKind, Review, Severity } from "@diffwise/shared";

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
  `);
  return db;
}

export function saveReview(db: Database, review: Review): void {
  const insertReview = db.prepare(
    "INSERT INTO reviews (id, owner, repo, number, head_commit, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertFinding = db.prepare(
    `INSERT INTO findings (review_id, position, kind, severity, file, start_line, end_line, title, explanation, suggested_fix, security_reference)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const { owner, repo, number } = review.pullRequest;
  db.exec("BEGIN");
  try {
    insertReview.run(review.id, owner, repo, number, review.headCommit, review.model, review.createdAt);
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
  head_commit: string;
  model: string;
  created_at: string;
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
  const findingRows = db
    .prepare("SELECT * FROM findings WHERE review_id = ? ORDER BY position")
    .all(id) as unknown as FindingRow[];
  return {
    id: row.id,
    pullRequest: { owner: row.owner, repo: row.repo, number: row.number },
    headCommit: row.head_commit,
    model: row.model,
    createdAt: row.created_at,
    findings: findingRows.map(toFinding),
  };
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
