import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Badge, Button, ConnectionStatus, Finding, Menu, MenuGroup, MenuItem, Notice, ReviewState, Severity } from "../src/design-system/index.ts";

test.each([
  ["critical", "Critical", 4],
  ["high", "High", 3],
  ["medium", "Medium", 2],
  ["low", "Low", 1],
] as const)("%s Severity reads without colour: a %s label and %i lit bars", (severity, label, bars) => {
  const { container } = render(<Severity severity={severity} />);

  expect(screen.getByText(label)).toBeInTheDocument();
  expect(container.querySelectorAll(".dw-sev-bar.is-on")).toHaveLength(bars);
});

test("a Severity label can be overridden, but never left out", () => {
  render(<Severity severity="high">Hoch</Severity>);

  expect(screen.getByText("Hoch")).toBeInTheDocument();
  expect(screen.queryByText("High")).not.toBeInTheDocument();
});

test("an empty Severity label falls back to the Severity's name", () => {
  render(<Severity severity="high">{""}</Severity>);

  expect(screen.getByText("High")).toBeInTheDocument();
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

test("a Finding's title is an h3 unless it sits under a different heading", () => {
  const { rerender } = render(<Finding kind="bad-practice" severity="low" title="Magic number" />);
  expect(screen.getByRole("heading", { name: "Magic number" })).toHaveProperty("tagName", "H3");

  rerender(<Finding kind="bad-practice" severity="low" title="Magic number" headingLevel={4} />);
  expect(screen.getByRole("heading", { name: "Magic number" })).toHaveProperty("tagName", "H4");
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

test("a ConnectionStatus reads without colour: its text says the state, and its dot is hidden from screen readers", () => {
  const { container } = render(
    <ul aria-label="Connections">
      <li>
        <ConnectionStatus status="error">GitHub unreachable</ConnectionStatus>
      </li>
    </ul>,
  );

  expect(screen.getByRole("listitem")).toHaveTextContent(/^GitHub unreachable$/);
  expect(container.querySelector(".dw-conn-dot")).toHaveAttribute("aria-hidden", "true");
});

test.each([
  ["running", "Running"],
  ["complete", "Complete"],
  ["unsaved", "Unsaved"],
  ["outdated", "Outdated"],
] as const)("a %s ReviewState reads without colour: it says %s, beside a marker hidden from screen readers", (state, label) => {
  const { container } = render(<ReviewState state={state} />);

  expect(container.firstElementChild).toHaveTextContent(new RegExp(`^${label}$`));
  expect(container.querySelector(".dw-state-mark")).toHaveAttribute("aria-hidden", "true");
});

test("a Notice names the situation, says what it means, and offers its one action", async () => {
  const onClick = vi.fn();
  render(
    <Notice role="note" title="Outdated" action={<Button onClick={onClick}>Review the latest commit</Button>}>
      New commits were pushed since this Review ran.
    </Notice>,
  );

  const notice = screen.getByRole("note");
  expect(notice).toHaveTextContent(/^OutdatedNew commits were pushed since this Review ran\.Review the latest commit$/);
  await userEvent.click(within(notice).getByRole("button", { name: "Review the latest commit" }));
  expect(onClick).toHaveBeenCalledOnce();
});

test("beside a diff, a Finding's location is a button to its lines, current when its lines are the ones shown", async () => {
  const onShowLines = vi.fn();
  const { rerender } = render(
    <Finding kind="bad-practice" severity="low" title="Magic number" file="src/config.ts" lines="1–2" onShowLines={onShowLines} />,
  );

  const location = screen.getByRole("button", { name: "src/config.ts:1–2" });
  expect(location).not.toHaveAttribute("aria-current");
  await userEvent.click(location);
  expect(onShowLines).toHaveBeenCalledOnce();

  rerender(<Finding kind="bad-practice" severity="low" title="Magic number" file="src/config.ts" lines="1–2" onShowLines={onShowLines} linesShown />);
  expect(screen.getByRole("button", { name: "src/config.ts:1–2" })).toHaveAttribute("aria-current", "true");
});

test("a Severity in a summary puts its count before its label", () => {
  render(<Severity severity="critical" count={2} />);

  expect(screen.getByText("2 Critical")).toBeInTheDocument();
});

test("a Menu's groups are named by their labels, and a group that can't be used says why in place of its items", () => {
  render(
    <Menu label="Choose a Model for this Review">
      <MenuGroup label="Ollama" aside={<ConnectionStatus status="ok">Connected</ConnectionStatus>}>
        <MenuItem selected>qwen2.5-coder:14b</MenuItem>
        <MenuItem>llama3.1:8b</MenuItem>
      </MenuGroup>
      <MenuGroup label="OpenAI-compatible" note="Couldn't reach https://llm.internal.example/v1: connection refused." />
    </Menu>,
  );

  const menu = screen.getByRole("group", { name: "Choose a Model for this Review" });
  const ollama = within(menu).getByRole("group", { name: "Ollama" });
  expect(within(ollama).getByRole("button", { name: "qwen2.5-coder:14b" })).toHaveAttribute("aria-pressed", "true");
  expect(within(ollama).getByRole("button", { name: "llama3.1:8b" })).toHaveAttribute("aria-pressed", "false");
  const openAI = within(menu).getByRole("group", { name: "OpenAI-compatible" });
  expect(openAI).toHaveTextContent("connection refused");
  expect(within(openAI).queryByRole("button")).not.toBeInTheDocument();
});
