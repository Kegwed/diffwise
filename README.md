# Diffwise

A self-hosted AI Pull Request reviewer. Diffwise reads a Pull Request's changes and reports Bad Practices and Security Issues, using a Model you choose (for example a local one through Ollama). See [CONTEXT.md](CONTEXT.md) for the vocabulary.

> **Status: walking skeleton.** Diffwise currently reviews built-in fixture Pull Requests (no GitHub connection yet).

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

4. Open http://localhost:5173, pick a Model from the dropdown (it lists the Models each Model Provider offers, grouped by Model Provider), then click **Review** on the fixture Pull Request. A Model Provider that can't be reached is shown as unavailable, with the reason. Each changed file is sent to the Model separately, so a Review takes a little while on a local Model. The Findings appear grouped by file when it's finished, along with each file's File Outcome: reviewed, skipped (lockfiles, minified assets, build output, binaries and very large diffs are never sent to the Model) or failed (the Model's reply was invalid or the call errored or timed out, twice). A Review with any skipped or failed file is flagged as having incomplete coverage.

### Configuration

Set these in `.env` at the repo root, or in the environment:

| Variable                   | Default                     | Meaning                                                                  |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| `DIFFWISE_OLLAMA_URL`      | `http://localhost:11434/v1` | Ollama's OpenAI-compatible endpoint; set it empty to turn Ollama off     |
| `DIFFWISE_OPENAI_BASE_URL` | `https://api.openai.com/v1` | Base URL of any OpenAI-compatible API                                    |
| `DIFFWISE_OPENAI_API_KEY`  | (none)                      | Its API key; setting this or the base URL turns this Model Provider on |
| `DIFFWISE_PORT`            | `3001`                      | Backend port (the frontend proxies `/api` to it)                         |
| `DIFFWISE_DB`              | `diffwise.db` at repo root  | SQLite file where Reviews are saved                                      |

API keys stay on the backend: they are never sent to the browser or saved in the database.

## Development

```sh
npm test            # backend and frontend tests
npm run typecheck   # all workspaces
```

The workspace has three packages:

- `shared`: the API contract types (Pull Request summary, Review, File Outcome, Finding), used by both sides.
- `backend`: a Hono HTTP API. The Review Engine depends only on the `Forge` and `ModelProvider` ports. Tests drive the API with the fixture Forge, a scripted fake Model Provider and in-memory SQLite.
- `frontend`: React + Vite. Tests render the app with React Testing Library against fixture API responses.
