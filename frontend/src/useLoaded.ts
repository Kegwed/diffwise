import { useEffect, useState } from "react";

/** What a view loads when it's first shown: nothing while loading, then the data or why it couldn't be loaded. */
export type Loaded<T> = { data?: undefined; error?: undefined } | { data: T; error?: undefined } | { data?: undefined; error: string };

/** Loads once, when the view using it is first shown; a view shown again for something else needs a new `key`. */
export function useLoaded<T>(load: () => Promise<T>): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({});

  useEffect(() => {
    let shown = true;
    load().then(
      (data) => shown && setLoaded({ data }),
      (error: Error) => shown && setLoaded({ error: error.message }),
    );
    return () => {
      shown = false;
    };
    // Only on first showing: `load` is a new function every render.
  }, []);

  return loaded;
}
