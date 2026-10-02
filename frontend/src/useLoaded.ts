import { useEffect, useState } from "react";

/** What a view loads when it's first shown: nothing while loading, then the data or why it couldn't be loaded. */
export type Loaded<T> = { data?: undefined; error?: undefined } | { data: T; error?: undefined } | { data?: undefined; error: string };

/** What a view has loaded, and whether that's from before `reloadOn` last changed, with the new load yet to settle. */
export type Reloaded<T> = Loaded<T> & { reloading: boolean };

/**
 * Loads when the view using it is first shown, and again whenever one of `reloadOn` changes, keeping what it had
 * until the new load settles. A view shown again for something else needs a new `key`.
 */
export function useLoaded<T>(load: () => Promise<T>, reloadOn: unknown[] = []): Reloaded<T> {
  const [{ loaded, on }, setLoaded] = useState<{ loaded: Loaded<T>; on: unknown[] }>({ loaded: {}, on: reloadOn });

  useEffect(() => {
    let current = true;
    load().then(
      (data) => current && setLoaded({ loaded: { data }, on: reloadOn }),
      (error: Error) => current && setLoaded({ loaded: { error: error.message }, on: reloadOn }),
    );
    return () => {
      current = false;
    };
    // Not on every render: `load` is a new function each time.
  }, reloadOn);

  return { ...loaded, reloading: on.length !== reloadOn.length || on.some((value, i) => !Object.is(value, reloadOn[i])) };
}
