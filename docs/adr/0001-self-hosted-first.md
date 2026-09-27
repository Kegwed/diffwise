# Self-hosted first, not a hosted service

Diffwise runs on the user's own machine (or their own server) rather than as a hosted web app. Ollama support is a core feature, and Ollama typically listens on the user's `localhost`, which a hosted backend cannot reach without the user exposing it to the internet. Self-hosting also lets v1 skip accounts, auth, billing and multi-tenancy: each user brings their own model API keys and their own GitHub App.

## Considered Options

- **Hosted web app**: easiest to demo via a link, but Ollama would effectively stop working, leaving only paid APIs.
- **Hosted frontend calling models from the browser**: keeps Ollama reachable, but relies on each user configuring Ollama's CORS origins, and puts API keys in the browser.

## Consequences

- Webhooks cannot reach a local instance without a tunnel, so v1 Reviews are triggered manually rather than on Pull Request events.
- Becoming a hosted product later is a deliberate migration (auth, key storage, a shared GitHub App), not a config change. The code should keep model and GitHub access behind interfaces so that migration is contained.
