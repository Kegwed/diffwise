import { FIXTURE_REPOSITORY, type ModelProviderListing } from "@diffwise/shared";
import { listModels } from "./api.ts";
import { Button, ConnectionStatus } from "./design-system/index.ts";
import { pullRequestHref } from "./route.ts";
import { isPending, useLoaded } from "./useLoaded.ts";

const SETUP_STEPS = [
  { title: "Create GitHub App", text: "Diffwise registers an App under your GitHub account or organization." },
  { title: "Install on Repositories", text: "Choose which Repositories Diffwise may read. You can add more later." },
  { title: "Review a Pull Request", text: "Paste its URL to open it, pick a Model for this Review and press Review." },
];

/** Home before Diffwise's GitHub App is created: offers to create it, or to try the fixture Pull Request without it. */
export function FirstRun() {
  return (
    <div className="page first-run">
      <section aria-labelledby="first-run" className="first-run-intro">
        <h2 id="first-run">Connect GitHub to review Pull Requests</h2>
        <p>
          Diffwise reads Pull Requests through a GitHub App that you own, since Diffwise is self-hosted. Create the App,
          install it on the Repositories you want reviewed, and you can paste any of their Pull Request URLs.
        </p>
        <div className="first-run-actions">
          {/* A plain navigation: the backend's page posts the App manifest on to GitHub, and GitHub sends the browser back here. */}
          <form method="get" action="/api/github-app/new">
            <Button type="submit" variant="primary">
              Create GitHub App
            </Button>
          </form>
          {/* The Secondary Button's look on a link: the fixture's Pull Requests are served without GitHub. */}
          <a className="dw-btn dw-btn-secondary dw-btn-md" href={pullRequestHref({ ...FIXTURE_REPOSITORY, number: 1 })}>
            Skip and try the fixture Pull Request
          </a>
        </div>
        <p className="caption">
          GitHub asks you to confirm the App's name and permissions. The fixture, {FIXTURE_REPOSITORY.owner}/
          {FIXTURE_REPOSITORY.repo}, needs no GitHub connection.
        </p>
      </section>
      <section aria-labelledby="setup-steps" className="card">
        <div className="card-head">
          <h3 id="setup-steps">What happens next</h3>
        </div>
        <ol className="setup-steps">
          {SETUP_STEPS.map((step, i) => (
            <li key={step.title}>
              <span className="setup-step-number" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <h4>{step.title}</h4>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <ModelProviders />
    </div>
  );
}

function ModelProviders() {
  const modelProviders = useLoaded(listModels);

  return (
    <section aria-labelledby="model-providers" className="card">
      <div className="card-head">
        <h3 id="model-providers">Model Providers</h3>
        <span className="caption">Chosen for each Review</span>
      </div>
      {isPending(modelProviders) && <p className="card-note">Checking Model Providers…</p>}
      {modelProviders.error && (
        <p role="alert" className="card-note">
          {modelProviders.error}
        </p>
      )}
      {modelProviders.data && (
        <ul className="model-providers">
          {modelProviders.data.map((listing) => (
            <ModelProviderRow key={listing.modelProvider} listing={listing} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ModelProviderRow({ listing }: { listing: ModelProviderListing }) {
  const available = listing.status === "available";
  return (
    <li>
      <div className="model-provider-head">
        <span className="model-provider-name">{listing.modelProvider}</span>
        <ConnectionStatus status={available ? "ok" : "error"}>{available ? "Connected" : "Unavailable"}</ConnectionStatus>
      </div>
      <p className="caption">{available ? modelCount(listing.models.length) : listing.reason}</p>
    </li>
  );
}

function modelCount(count: number): string {
  if (count === 0) return "No Models available";
  return `${count} ${count === 1 ? "Model" : "Models"} available`;
}
