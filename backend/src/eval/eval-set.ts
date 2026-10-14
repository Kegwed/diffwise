import type { FixturePullRequest } from "../fixture-forge.ts";
import type { PlantedProblem } from "./scoring.ts";

/** One fixture Pull Request of the Eval Set, with the Planted Problems a good Review of it should report. */
export interface EvalFixture {
  pullRequest: FixturePullRequest;
  plantedProblems: PlantedProblem[];
}

/** A file the Pull Request adds, so line N of the file is `lines[N - 1]`. */
function newFile(path: string, lines: string[]): FixturePullRequest["files"][number] {
  return { path, patch: [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join("\n") };
}

const OWNER = "diffwise-eval";
const AUTHOR = "eval-author";

const passwordReset: EvalFixture = {
  pullRequest: {
    owner: OWNER,
    repo: "accounts",
    number: 1,
    title: "Add password reset",
    author: AUTHOR,
    headCommit: "a1f4c09e2b7d4a6f8c3e5d1b9a0f2e4c6d8b7a51",
    description: "Lets a user request a password reset link by email, and hashes the new password before saving it.",
    files: [
      newFile("src/auth/reset.ts", [
        "import crypto from 'crypto';",
        "import { db } from '../db';",
        "import { sendMail } from '../mail';",
        "",
        "export async function requestPasswordReset(email: string) {",
        "  const token = Math.random().toString(36).slice(2);",
        "  await db.query(`UPDATE users SET reset_token = '${token}' WHERE email = '${email}'`);",
        "  await sendMail(email, `Reset your password: https://accounts.example.com/reset?token=${token}`);",
        "}",
        "",
        "export function hashPassword(password: string) {",
        "  return crypto.createHash('md5').update(password).digest('hex');",
        "}",
      ]),
      {
        path: "src/routes/reset.ts",
        patch: [
          "@@ -1,3 +1,9 @@",
          " import { Router } from 'express';",
          "+import { requestPasswordReset } from '../auth/reset';",
          " ",
          " export const router = Router();",
          "+",
          "+router.post('/reset', async (req, res) => {",
          "+  await requestPasswordReset(req.body.email);",
          "+  res.send(`<p>We sent a reset link to ${req.body.email}</p>`);",
          "+});",
        ].join("\n"),
      },
    ],
  },
  plantedProblems: [
    {
      kind: "security-issue",
      file: "src/auth/reset.ts",
      startLine: 6,
      endLine: 6,
      description: "Reset token made with Math.random(), which is predictable",
    },
    {
      kind: "security-issue",
      file: "src/auth/reset.ts",
      startLine: 7,
      endLine: 7,
      description: "SQL injection through the email interpolated into the query",
    },
    {
      kind: "security-issue",
      file: "src/auth/reset.ts",
      startLine: 12,
      endLine: 12,
      description: "Passwords hashed with unsalted MD5",
    },
    {
      kind: "security-issue",
      file: "src/routes/reset.ts",
      startLine: 8,
      endLine: 8,
      description: "Reflected XSS through the email written into the HTML response",
    },
  ],
};

const paymentClient: EvalFixture = {
  pullRequest: {
    owner: OWNER,
    repo: "payments",
    number: 1,
    title: "Point the payment client at production",
    author: AUTHOR,
    headCommit: "b72e5d13c8a94f0e6b1d3c5a7e9f0b2d4c6a8e13",
    description: "Uses the production payments API with its key, and logs each charge so support can trace it.",
    files: [
      {
        path: "src/payments/client.ts",
        patch: [
          "@@ -1,7 +1,13 @@",
          " import { http } from '../http';",
          " ",
          "-const API_URL = process.env.PAYMENTS_URL;",
          "+const API_URL = 'https://api.payments.example.com';",
          "+const API_KEY = 'sk_live_51Hx9dKq2mVb8RtYw3ZpLc7Nf';",
          " ",
          " export async function charge(amount: number, card: string) {",
          "-  return http.post(`${API_URL}/charges`, { amount, card });",
          "+  console.log(`Charging card ${card} for ${amount}`);",
          "+  try {",
          "+    return await http.post(`${API_URL}/charges`, { amount, card }, { headers: { authorization: API_KEY } });",
          "+  } catch (e) {",
          "+    return null;",
          "+  }",
          " }",
        ].join("\n"),
      },
    ],
  },
  plantedProblems: [
    {
      kind: "security-issue",
      file: "src/payments/client.ts",
      startLine: 4,
      endLine: 4,
      description: "Hard-coded live API key",
    },
    {
      kind: "security-issue",
      file: "src/payments/client.ts",
      startLine: 7,
      endLine: 7,
      description: "Full card number written to the log",
    },
    {
      kind: "bad-practice",
      file: "src/payments/client.ts",
      startLine: 10,
      endLine: 12,
      description: "Swallowed error: a failed charge returns null with nothing logged or rethrown",
    },
  ],
};

const fileServing: EvalFixture = {
  pullRequest: {
    owner: OWNER,
    repo: "uploads",
    number: 1,
    title: "Serve uploaded files and their thumbnails",
    author: AUTHOR,
    headCommit: "c93a7e24d1b05f6a8c2e4d6b8a0c1e3f5d7b9a24",
    description: "Adds a download endpoint for uploaded files and one that makes a thumbnail with ImageMagick.",
    files: [
      newFile("src/files.ts", [
        "import { exec } from 'child_process';",
        "import fs from 'fs';",
        "import path from 'path';",
        "import type { Request, Response } from 'express';",
        "",
        "const UPLOADS = '/srv/uploads';",
        "",
        "export function download(req: Request, res: Response) {",
        "  const file = path.join(UPLOADS, req.query.name as string);",
        "  res.send(fs.readFileSync(file));",
        "}",
        "",
        "export function thumbnail(req: Request, res: Response) {",
        "  exec(`convert ${UPLOADS}/${req.query.name} -resize 100x100 /tmp/thumbnail.png`, () => {",
        "    res.sendFile('/tmp/thumbnail.png');",
        "  });",
        "}",
      ]),
    ],
  },
  plantedProblems: [
    {
      kind: "security-issue",
      file: "src/files.ts",
      startLine: 9,
      endLine: 10,
      description: "Path traversal: the requested name can climb out of the uploads directory",
    },
    {
      kind: "security-issue",
      file: "src/files.ts",
      startLine: 14,
      endLine: 14,
      description: "Command injection through the name interpolated into a shell command",
    },
  ],
};

const reportLoader: EvalFixture = {
  pullRequest: {
    owner: OWNER,
    repo: "reports",
    number: 1,
    title: "Add report loading and tagging",
    author: AUTHOR,
    headCommit: "d04b8f35e2c16a7b9d3f5e7c9b1d2f4a6e8c0b35",
    description: "Fetches a report from another service, loads it, and adds helpers to tag it and average its durations.",
    files: [
      newFile("reports/loader.py", [
        "import pickle",
        "import requests",
        "",
        "",
        "def load_report(blob):",
        "    return pickle.loads(blob)",
        "",
        "",
        "def fetch_report(url):",
        "    response = requests.get(url, verify=False)",
        "    return load_report(response.content)",
        "",
        "",
        "def add_tag(report, tag, tags=[]):",
        "    tags.append(tag)",
        '    report["tags"] = tags',
        "    return report",
        "",
        "",
        "def average_duration(report):",
        "    try:",
        '        return sum(report["durations"]) / len(report["durations"])',
        "    except:",
        "        pass",
      ]),
    ],
  },
  plantedProblems: [
    {
      kind: "security-issue",
      file: "reports/loader.py",
      startLine: 6,
      endLine: 6,
      description: "Insecure deserialization: pickle.loads on data fetched over the network",
    },
    {
      kind: "security-issue",
      file: "reports/loader.py",
      startLine: 10,
      endLine: 10,
      description: "TLS certificate verification turned off",
    },
    {
      kind: "bad-practice",
      file: "reports/loader.py",
      startLine: 14,
      endLine: 15,
      description: "Mutable default argument shared between calls",
    },
    {
      kind: "bad-practice",
      file: "reports/loader.py",
      startLine: 23,
      endLine: 24,
      description: "Swallowed error: a bare except that passes",
    },
  ],
};

const cartTotals: EvalFixture = {
  pullRequest: {
    owner: OWNER,
    repo: "cart",
    number: 1,
    title: "Add cart totals, discounts and saving",
    author: AUTHOR,
    headCommit: "e15c9a46f3d27b8c0e4a6f8d0c2e3a5b7f9d1c46",
    description: "Works out a cart's total, applies discount codes, and saves the cart to the server.",
    files: [
      {
        path: "src/cart.ts",
        patch: [
          "@@ -1,4 +1,25 @@",
          " export interface Item {",
          "   price: number;",
          "   qty: number;",
          " }",
          "+",
          "+export function cartTotal(items: Item[]) {",
          "+  let total = 0;",
          "+  for (let i = 0; i <= items.length; i++) {",
          "+    total += items[i].price * items[i].qty;",
          "+  }",
          "+  return total;",
          "+}",
          "+",
          "+export function applyDiscount(total: any, code: any) {",
          "+  if (code === 'SUMMER') {",
          "+    return total * 0.9;",
          "+  } else if (code === 'VIP') {",
          "+    return total * 0.8;",
          "+  }",
          "+  return total;",
          "+}",
          "+",
          "+export async function saveCart(items: Item[]) {",
          "+  fetch('/api/cart', { method: 'POST', body: JSON.stringify(items) });",
          "+}",
        ].join("\n"),
      },
    ],
  },
  plantedProblems: [
    {
      kind: "bad-practice",
      file: "src/cart.ts",
      startLine: 8,
      endLine: 9,
      description: "Off-by-one: the loop reads one item past the end of the array",
    },
    {
      kind: "bad-practice",
      file: "src/cart.ts",
      startLine: 14,
      endLine: 14,
      description: "Parameters typed any, which turns type checking off",
    },
    {
      kind: "bad-practice",
      file: "src/cart.ts",
      startLine: 24,
      endLine: 24,
      description: "Unawaited fetch: the save's failure is never noticed",
    },
  ],
};

export const EVAL_SET: EvalFixture[] = [passwordReset, paymentClient, fileServing, reportLoader, cartTotals];
