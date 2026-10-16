import { FIXTURE_REPOSITORY, isFixtureRepository, type RepositoryListing, type RepositoryRef } from "@diffwise/shared";
import { Button, EmptyState, Skeleton } from "./design-system/index.ts";
import { repositoryHref } from "./route.ts";
import { isPending, type Reloaded } from "./useLoaded.ts";

/** Each skeleton row's name and caption widths, so the rows don't read as one block. */
const SKELETON_ROW_WIDTHS: { name: string; caption: string }[] = [
  { name: "60%", caption: "40%" },
  { name: "45%", caption: "35%" },
  { name: "55%", caption: "45%" },
];

/**
 * What the Repositories card shows below the fixture: skeletons while loading, why the installed Repositories couldn't
 * be loaded, that the GitHub App isn't installed anywhere yet, or the installed Repositories.
 */
export type RepositoriesState =
  | { state: "pending" }
  | { state: "unlisted"; reason: string; someListed: boolean }
  | { state: "installed-nowhere" }
  | { state: "listed" };

/** Where the Repositories card stands, once both the listing and the GitHub App's status have loaded. */
export function repositoriesState(listing: Reloaded<RepositoryListing>, githubAppLoaded: boolean): RepositoriesState {
  if (isPending(listing) || !githubAppLoaded) return { state: "pending" };
  const someListed = Boolean(listing.data?.repositories.some((repository) => !isFixtureRepository(repository)));
  const reason = listing.data?.unlisted ?? listing.error;
  if (reason !== undefined) return { state: "unlisted", reason, someListed };
  return someListed ? { state: "listed" } : { state: "installed-nowhere" };
}

/**
 * The Repositories Diffwise can read, the fixture first. `installUrl` is where the GitHub App is installed on
 * Repositories, once it's created; `onRetry` loads the listing again after it couldn't be.
 */
export function RepositoriesCard({
  listing,
  state,
  installUrl,
  onRetry,
}: {
  listing: Reloaded<RepositoryListing>;
  state: RepositoriesState;
  installUrl?: string;
  onRetry: () => void;
}) {
  // The fixture is always there, so it's listed before Diffwise has heard which other Repositories it can read.
  const repositories = listing.data?.repositories ?? [FIXTURE_REPOSITORY];

  return (
    <section aria-labelledby="repositories" className="card repositories">
      <div className="card-head">
        <h3 id="repositories">Repositories</h3>
        {(state.state === "listed" || state.state === "installed-nowhere") && (
          <span className="caption">{repositories.length} listed</span>
        )}
      </div>
      <ul aria-labelledby="repositories">
        {repositories.map((repository) => (
          <RepositoryRow key={`${repository.owner}/${repository.repo}`} repository={repository} />
        ))}
      </ul>
      {state.state === "pending" && (
        <div aria-hidden="true">
          {SKELETON_ROW_WIDTHS.map(({ name, caption }, i) => (
            <div key={i} className="repository-skeleton">
              <span>
                <Skeleton width={name} height={14} />
                <Skeleton width={caption} height={10} />
              </span>
              <Skeleton width={56} height={20} />
            </div>
          ))}
        </div>
      )}
      {state.state === "unlisted" && (
        <EmptyState
          role="alert"
          title={state.someListed ? "Couldn't load some installed Repositories" : "Couldn't load installed Repositories"}
          action={<Button onClick={onRetry}>Try again</Button>}
        >
          {state.reason}
        </EmptyState>
      )}
      {state.state === "installed-nowhere" && installUrl && (
        <EmptyState
          title="No installed Repositories yet"
          action={
            <Button variant="primary" href={installUrl}>
              Install on Repositories
            </Button>
          }
        >
          The GitHub App is created but isn't installed anywhere. Choose the Repositories Diffwise may read.
        </EmptyState>
      )}
      {state.state === "listed" && installUrl && (
        <div className="card-note">
          <Button variant="ghost" size="sm" href={installUrl}>
            Install on more Repositories
          </Button>
        </div>
      )}
    </section>
  );
}

function RepositoryRow({ repository }: { repository: RepositoryRef }) {
  return (
    <li>
      <a href={repositoryHref(repository)}>
        {repository.owner}/{repository.repo}
      </a>
      {isFixtureRepository(repository) && <span className="caption">Built-in fixture. Works without GitHub.</span>}
    </li>
  );
}
