import { useId, useState, type FormEvent } from "react";
import { ApiRequestError, findPullRequestByUrl } from "./api.ts";
import { Button } from "./design-system/index.ts";
import { navigate, pullRequestHref } from "./route.ts";

/**
 * Jumps straight to the detail view of the Pull Request a pasted GitHub URL points at, or says under the field what's
 * wrong with it. `installUrl` is where the GitHub App is installed on more Repositories, once it's created. `hint` is
 * said under the field until there's an error to say there instead.
 */
export function PullRequestUrlForm({ installUrl, hint, disabled = false }: { installUrl?: string; hint?: string; disabled?: boolean }) {
  const [url, setUrl] = useState("");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<{ message: string; notInstalled: boolean }>();
  const errorId = useId();
  const hintId = useId();

  async function open(event: FormEvent) {
    event.preventDefault();
    setOpening(true);
    setError(undefined);
    try {
      navigate(pullRequestHref(await findPullRequestByUrl(url)));
    } catch (e) {
      // A 403 is a Repository Diffwise can't read, which installing its GitHub App there puts right.
      setError({ message: (e as Error).message, notInstalled: e instanceof ApiRequestError && e.status === 403 });
      setOpening(false);
    }
  }

  return (
    <section className="card pull-request-url">
      <div className="pull-request-url-head">
        <h2>
          <label htmlFor="pull-request-url">Paste a Pull Request URL</label>
        </h2>
        <p className="caption">
          Opens the Pull Request page, where you pick a Model and start a Review. Links to /files and /commits, and closed
          Pull Requests, work too.
        </p>
      </div>
      <form onSubmit={open}>
        <div className="pull-request-url-field">
          <input
            id="pull-request-url"
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(undefined);
            }}
            placeholder="https://github.com/owner/repo/pull/123"
            spellCheck={false}
            disabled={disabled}
            aria-invalid={error !== undefined}
            aria-describedby={error ? errorId : hint && hintId}
          />
          {!error && hint && (
            <p id={hintId} className="caption">
              {hint}
            </p>
          )}
          {error && (
            <p id={errorId} role="alert" className="pull-request-url-error">
              {error.message}
              {error.notInstalled && installUrl && (
                <>
                  {" "}
                  <a href={installUrl}>Install on more Repositories</a>
                </>
              )}
            </p>
          )}
        </div>
        <Button type="submit" variant="primary" disabled={disabled || opening || url.trim() === ""}>
          {opening ? "Opening…" : "Open"}
        </Button>
      </form>
    </section>
  );
}
