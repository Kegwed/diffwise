import { useEffect, useReducer, useState } from "react";

/** What a view loads when it's first shown: nothing while loading, then the data or why it couldn't be loaded. */
export type Loaded<T> = { data?: undefined; error?: undefined } | { data: T; error?: undefined } | { data?: undefined; error: string };

/** What a view has loaded, and whether that's from before `reloadOn` last changed, with the new load yet to settle. */
export type Reloaded<T> = Loaded<T> & { reloading: boolean };

/** Whether nothing has been loaded yet, not even why it couldn't be. */
export function isFirstLoading(loaded: Loaded<unknown>): boolean {
  return loaded.data === undefined && loaded.error === undefined;
}

/** Whether what's loaded is still to come: not yet loaded, or being loaded again. */
export function isPending(loaded: Reloaded<unknown>): boolean {
  return loaded.reloading || isFirstLoading(loaded);
}

/** Loads like `useLoaded`, and returns a function that loads again, as trying again after a failure does. */
export function useRetryable<T>(load: () => Promise<T>): [Reloaded<T>, () => void] {
  const [tries, retry] = useReducer((n: number) => n + 1, 0);
  return [useLoaded(load, [tries]), retry];
}

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
