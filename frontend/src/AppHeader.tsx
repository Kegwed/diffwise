import { getGitHubApp, listModels } from "./api.ts";
import { ConnectionStatus } from "./design-system/index.ts";
import { REPOSITORIES_HREF } from "./route.ts";
import { useLoaded } from "./useLoaded.ts";

/**
 * The header every view shares: the name, leading to the first view, and whether Diffwise can reach what it depends on.
 * `githubUnreachable` is set where the view has found GitHub couldn't be reached.
 */
export function AppHeader({ githubUnreachable }: { githubUnreachable: boolean }) {
  const githubApp = useLoaded(getGitHubApp);
  const modelProviders = useLoaded(listModels);

  return (
    <header className="app-header">
      <div className="app-header-in">
        <h1 className="brand">
          <a href={REPOSITORIES_HREF}>Diffwise</a>
        </h1>
        <ul className="connections" aria-label="Connections">
          {!githubApp.data && !githubApp.error && (
            <li>
              <ConnectionStatus status="idle">Checking GitHub</ConnectionStatus>
            </li>
          )}
          {githubApp.data && (
            <li>
              {githubApp.data.status === "not-created" ? (
                <ConnectionStatus status="warn">GitHub not connected</ConnectionStatus>
              ) : githubUnreachable ? (
                <ConnectionStatus status="error">GitHub unreachable</ConnectionStatus>
              ) : (
                <ConnectionStatus status="ok">GitHub connected</ConnectionStatus>
              )}
            </li>
          )}
          {!modelProviders.data && !modelProviders.error && (
            <li>
              <ConnectionStatus status="idle">Checking Model Providers</ConnectionStatus>
            </li>
          )}
          {/* A Model Provider's reason for being unavailable is shown where a Model is chosen, not here. */}
          {modelProviders.data?.map((listing) => (
            <li key={listing.modelProvider}>
              {listing.status === "available" ? (
                <ConnectionStatus status="ok">{listing.modelProvider} connected</ConnectionStatus>
              ) : (
                <ConnectionStatus status="error">{listing.modelProvider} unavailable</ConnectionStatus>
              )}
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}
