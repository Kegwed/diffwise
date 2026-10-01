import { useState, type FormEvent } from "react";
import { findPullRequestByUrl } from "./api.ts";
import { Button } from "./design-system/index.ts";
import { navigate, pullRequestHref } from "./route.ts";

/** Jumps straight to the detail view of the Pull Request a pasted GitHub URL points at, or says what's wrong with it. */
export function PullRequestUrlForm() {
  const [url, setUrl] = useState("");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string>();

  async function open(event: FormEvent) {
    event.preventDefault();
    setOpening(true);
    setError(undefined);
    try {
      navigate(pullRequestHref(await findPullRequestByUrl(url)));
    } catch (e) {
      setError((e as Error).message);
      setOpening(false);
    }
  }

  return (
    <>
      <form className="pull-request-url" onSubmit={open}>
        <label>
          Pull Request URL{" "}
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo/pull/123"
            spellCheck={false}
          />
        </label>
        <Button type="submit" size="sm" disabled={opening || url.trim() === ""}>
          {opening ? "Opening…" : "Open"}
        </Button>
      </form>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
