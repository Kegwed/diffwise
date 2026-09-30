import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { Badge, Button, Finding, Severity } from "../src/design-system/index.ts";

test.each([
  ["critical", "Critical", 4],
  ["high", "High", 3],
  ["medium", "Medium", 2],
  ["low", "Low", 1],
] as const)("%s Severity reads without colour: a %s label and %i lit bars", (level, label, bars) => {
  const { container } = render(<Severity level={level} />);

  expect(screen.getByText(label)).toBeInTheDocument();
  expect(container.querySelectorAll(".dw-sev-bar.is-on")).toHaveLength(bars);
});

test("a Severity label can be overridden, but never left out", () => {
  render(<Severity level="high">Hoch</Severity>);

  expect(screen.getByText("Hoch")).toBeInTheDocument();
  expect(screen.queryByText("High")).not.toBeInTheDocument();
});

test("a Security Issue shows its Security Reference as an outline Badge after its kind", () => {
  render(
    <Finding kind="security-issue" severity="critical" securityReference="CWE-89" title="SQL injection" file="a.ts" lines={3} />,
  );

  const kind = screen.getByText("Security Issue");
  const reference = screen.getByText("CWE-89");
  expect(reference).toHaveClass("dw-badge-outline");
  expect(kind.compareDocumentPosition(reference) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("a Bad Practice never shows a Security Reference, even if it has one", () => {
  render(<Finding kind="bad-practice" severity="low" securityReference="CWE-89" title="Magic number" />);

  expect(screen.getByText("Bad Practice")).toBeInTheDocument();
  expect(screen.queryByText("CWE-89")).not.toBeInTheDocument();
});

test("a Finding shows its Severity, file and lines, title, explanation and a collapsed Suggested Fix", async () => {
  render(
    <Finding kind="bad-practice" severity="medium" file="src/users.ts" lines="5–6" title="Swallowed error" suggestedFix={"log(e);\n"}>
      <p>The catch block ignores the error.</p>
    </Finding>,
  );

  expect(screen.getByText("Medium")).toBeInTheDocument();
  expect(screen.getByText("src/users.ts:5–6")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Swallowed error" })).toBeInTheDocument();
  expect(screen.getByText("The catch block ignores the error.")).toBeInTheDocument();

  const fix = screen.getByText("log(e);");
  expect(fix).not.toBeVisible();
  await userEvent.click(screen.getByText("Suggested Fix"));
  expect(fix).toBeVisible();
});

test("a Finding without a Suggested Fix has no Suggested Fix section", () => {
  render(<Finding kind="bad-practice" severity="low" title="Magic number" />);

  expect(screen.queryByText("Suggested Fix")).not.toBeInTheDocument();
});

test("Button is secondary and md by default, and a button that doesn't submit", () => {
  render(<Button onClick={() => {}}>Run review</Button>);

  const button = screen.getByRole("button", { name: "Run review" });
  expect(button).toHaveClass("dw-btn", "dw-btn-secondary", "dw-btn-md");
  expect(button).toHaveAttribute("type", "button");
});

test("Badge is neutral by default", () => {
  render(<Badge>Skipped</Badge>);

  expect(screen.getByText("Skipped")).toHaveClass("dw-badge", "dw-badge-neutral");
});
