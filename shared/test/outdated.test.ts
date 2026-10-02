import { expect, test } from "vitest";
import { isOutdated } from "../src/index.ts";

test("a Review is Outdated when its head commit is no longer the Pull Request's head commit", () => {
  expect(isOutdated({ headCommit: "abc1234" }, { headCommit: "def5678" })).toBe(true);
});

test("a Review of the Pull Request's head commit isn't Outdated", () => {
  expect(isOutdated({ headCommit: "abc1234" }, { headCommit: "abc1234" })).toBe(false);
});
