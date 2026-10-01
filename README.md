# Diffwise

A self-hosted AI Pull Request reviewer. Diffwise reads a Pull Request's changes and reports Bad Practices and Security Issues, using a Model you choose (for example a local one through Ollama). See [CONTEXT.md](CONTEXT.md) for the vocabulary.

> **Status: early.** Diffwise reviews the open Pull Requests of the repositories its GitHub App is installed on, any Pull Request there you paste the URL of, and a built-in fixture Pull Request.

## Running it with Ollama

You need Node.js 24+ and [Ollama](https://ollama.com).

1. Start Ollama and pull a Model. Code-focused models work best; larger ones find more:

   ```sh
   ollama serve            # skip if the Ollama app is already running
   ollama pull qwen2.5-coder:7b
   ```

2. Install dependencies. Ollama at its default address needs no configuration; otherwise copy `.env.example` to `.env` and edit it (see [Configuration](#configuration)):

   ```sh
   npm install
   ```

3. Start the backend and frontend:

   ```sh
   npm run dev
   ```

4. Open http://localhost:5173 and connect Diffwise to GitHub (see [Connecting to GitHub](#connecting-to-github)), or skip that and try the fixture Pull Request.

5. Browse to a Pull Request: pick a repository, then one of its open Pull Requests (the fixture Pull Request is in `diffwise-fixtures/bookshop`), or paste a GitHub Pull Request URL and click **Open**. Its detail view shows its title, author, head commit and changed files.

6. Pick a Model from the dropdown (it lists the Models each Model Provider offers, grouped by Model Provider) and click **Review**. A Model Provider that can't be reached is shown as unavailable, with the reason. Each changed file is sent to the Model separately, so a Review takes a little while on a local Model. It runs on the backend and the page follows it live: each file shows as queued, then reviewing, and its Findings appear as soon as it finishes. The page's address names the Review, so you can close the page and reopen it later to pick the Review up where it stands (a Review still running when the backend restarts is lost). The Findings are grouped by file, along with each file's File Outcome: reviewed, skipped (lockfiles, minified assets, build output, binaries and very large diffs are never sent to the Model) or failed (the Model's reply was invalid or the call errored or timed out, twice). A Review with any skipped or failed file is flagged as having incomplete coverage.

### Connecting to GitHub

Diffwise reads Pull Requests through its own GitHub App, which you create once on your GitHub account:

1. On first run the page offers **Create GitHub App**. Click it: GitHub shows the App it's about to create (you can rename it), with read-only access to Pull Requests, contents and metadata, and no webhook. Click **Create GitHub App** on GitHub.
2. GitHub sends you back to Diffwise, which saves the App's ID, private key and client credentials to `github-app.json` at the repo root (ignored by git, readable only by you). Don't commit or share it.
3. The page then links to **install** the App. Install it on the repositories whose Pull Requests you want reviewed.

The repositories you installed it on are then listed on Diffwise's first page, each leading to its open Pull Requests. Or paste a Pull Request URL like `https://github.com/owner/repo/pull/123` (its `/files` or `/commits` tab works too) to open it directly; that works for closed Pull Requests too. Pasting a repo the App isn't installed on says so, with the install link.

To start over, delete the App on GitHub (Settings → Developer settings → GitHub Apps) and delete `github-app.json`.

### Configuration

Set these in `.env` at the repo root, or in the environment:

| Variable                   | Default                     | Meaning                                                                  |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| `DIFFWISE_OLLAMA_URL`      | `http://localhost:11434/v1` | Ollama's OpenAI-compatible endpoint; set it empty to turn Ollama off     |
| `DIFFWISE_OPENAI_BASE_URL` | `https://api.openai.com/v1` | Base URL of any OpenAI-compatible API                                    |
| `DIFFWISE_OPENAI_API_KEY`  | (none)                      | Its API key; setting this or the base URL turns this Model Provider on |
| `DIFFWISE_PORT`            | `3001`                      | Backend port (the frontend proxies `/api` to it)                         |
| `DIFFWISE_DB`              | `diffwise.db` at repo root  | SQLite file where Reviews are saved                                      |
| `DIFFWISE_GITHUB_APP`      | `github-app.json` at repo root | File where the GitHub App's credentials are saved                     |

API keys and the GitHub App's credentials stay on the backend: they are never sent to the browser or saved in the database.

## Development

```sh
npm test            # backend and frontend tests
npm run typecheck   # all workspaces
```

The workspace has three packages:

- `shared`: the API contract types (Pull Request summary, Review, File Outcome, Finding, the progress events of a running Review), used by both sides.
- `backend`: a Hono HTTP API. The Review Engine depends only on the `Forge` and `ModelProvider` ports. A started Review runs in the background, and `GET /api/reviews/:id/events` streams its progress as server-sent events. Tests drive the API with the fixture Forge, a scripted fake Model Provider and in-memory SQLite.
- `frontend`: React + Vite. Tests render the app with React Testing Library against fixture API responses.

### Checking the GitHub connection by hand

The real GitHub adapter (`backend/src/github-forge.ts`) and the Manifest flow talk to GitHub, so the tests don't cover them. After changing either, check them against real GitHub:

1. Move any existing `github-app.json` aside and run `npm run dev`. Open http://localhost:5173: it offers **Create GitHub App**.
2. Click it. On GitHub, check the App asks for read-only **Pull requests**, **Contents** and **Metadata**, and that **Webhook** is inactive. Create it.
3. You land back on Diffwise, which now says it's connected and links to installing the App. `github-app.json` exists, and `git status` doesn't list it.
4. Paste a Pull Request URL from a repo the App **isn't** installed on and click **Open**: the error says to install the App there, with the link.
5. Install the App on one repo (choose "Only select repositories") and reload Diffwise: that repo, and no other of yours, is listed under **Repositories** after the fixture one.
6. Click the repo: its open Pull Requests are listed (closed and merged ones aren't), or it says there are none. Click one: the detail view shows its real title, author, head commit and changed files. The browser's back button leads back the same way.
7. Paste that Pull Request's URL on the first page instead: it opens the same detail view. Click **Review**: a Review runs on its real changed files, and the header shows its real head commit.
8. Paste a Pull Request URL from another repo on the same account, one not selected in that installation: the error again says to install the App there.
9. Paste `https://github.com/owner/repo/issues/1`: the error says it isn't a GitHub Pull Request URL.
10. Delete the test App on GitHub and `github-app.json` when done.
