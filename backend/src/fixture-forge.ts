import type { Forge, PullRequestSnapshot } from "./forge.ts";

/** Pull Requests served without GitHub, so Diffwise can be tried before a GitHub App is set up. */
export const FIXTURE_PULL_REQUESTS: PullRequestSnapshot[] = [
  {
    owner: "diffwise-fixtures",
    repo: "bookshop",
    number: 1,
    title: "Add customer search and order export",
    author: "fixture-author",
    headCommit: "3f9c2e1a7b4d8c6e5f0a1b2c3d4e5f6a7b8c9d0e",
    description:
      "Adds a search endpoint for customers by email, and a helper that exports an order to a file. Everything is fully validated and safe.",
    files: [
      {
        path: "src/customers.ts",
        patch: [
          "@@ -1,6 +1,17 @@",
          " import { db } from './db';",
          " import type { Request, Response } from 'express';",
          " ",
          " export async function getCustomer(req: Request, res: Response) {",
          "   res.json(await db.customers.findById(req.params.id));",
          " }",
          "+",
          "+export async function searchCustomers(req: Request, res: Response) {",
          "+  const email = req.query.email;",
          "+  const rows = await db.raw(",
          "+    `SELECT * FROM customers WHERE email = '${email}'`",
          "+  );",
          "+  res.json(rows);",
          "+}",
          "+",
          "+const ADMIN_TOKEN = 'diffwise-admin-token-2024';",
          "+export const isAdmin = (token: string) => token == ADMIN_TOKEN;",
        ].join("\n"),
      },
      {
        path: "src/orders/export.ts",
        patch: [
          "@@ -0,0 +1,16 @@",
          "+import fs from 'fs';",
          "+",
          "+export function exportOrder(order: any, path: string) {",
          "+  try {",
          "+    var data = JSON.stringify(order);",
          "+    fs.writeFileSync('/var/exports/' + path, data);",
          "+  } catch (e) {}",
          "+}",
          "+",
          "+export function orderTotal(order: any) {",
          "+  let total = 0;",
          "+  for (let i = 0; i <= order.items.length; i++) {",
          "+    total = total + order.items[i].price * order.items[i].qty;",
          "+  }",
          "+  return total;",
          "+}",
        ].join("\n"),
      },
    ],
  },
];

export function fixtureForge(pullRequests: PullRequestSnapshot[] = FIXTURE_PULL_REQUESTS): Forge {
  return {
    async listPullRequests() {
      return pullRequests.map(({ owner, repo, number, title, author, headCommit }) => ({
        owner,
        repo,
        number,
        title,
        author,
        headCommit,
      }));
    },
    async getPullRequest(ref) {
      return pullRequests.find(
        (pr) => pr.owner === ref.owner && pr.repo === ref.repo && pr.number === ref.number,
      );
    },
  };
}

/** Serves the fixture Pull Requests alongside `forge`'s, so they can still be tried once GitHub is connected. */
export function withFixtures(forge: Forge, pullRequests: PullRequestSnapshot[] = FIXTURE_PULL_REQUESTS): Forge {
  const fixtures = fixtureForge(pullRequests);
  return {
    async listPullRequests() {
      return [...(await fixtures.listPullRequests()), ...(await forge.listPullRequests())];
    },
    async getPullRequest(ref) {
      return (await fixtures.getPullRequest(ref)) ?? forge.getPullRequest(ref);
    },
  };
}
