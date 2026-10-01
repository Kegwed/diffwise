import { useEffect, useState } from "react";

/** What a view loads when it's first shown: nothing while loading, then the data or why it couldn't be loaded. */
export type Loaded<T> = { data?: undefined; error?: undefined } | { data: T; error?: undefined } | { data?: undefined; error: string };

/**
 * Loads when the view using it is first shown, and again whenever one of `reloadOn` changes, keeping what it had
 * until the new load settles. A view shown again for something else needs a new `key`.
 */
export function useLoaded<T>(load: () => Promise<T>, reloadOn: unknown[] = []): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({});

  useEffect(() => {
    let current = true;
    load().then(
      (data) => current && setLoaded({ data }),
      (error: Error) => current && setLoaded({ error: error.message }),
    );
    return () => {
      current = false;
    };
    // Not on every render: `load` is a new function each time.
  }, reloadOn);

  return loaded;
}
