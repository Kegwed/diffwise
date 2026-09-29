import type { ModelProviderListing } from "@diffwise/shared";

/** A Model on the Model Provider that offers it. */
export interface ModelChoice {
  modelProvider: string;
  model: string;
}

/** The first Model any Model Provider offers, to preselect in the dropdown. */
export function firstModel(listings: ModelProviderListing[]): ModelChoice | undefined {
  for (const listing of listings) {
    if (listing.status === "available" && listing.models.length > 0) {
      return { modelProvider: listing.modelProvider, model: listing.models[0]! };
    }
  }
  return undefined;
}

// A <select> value is a string, so each option carries its Model Provider and Model as JSON.
const toValue = (choice: ModelChoice) => JSON.stringify([choice.modelProvider, choice.model]);
const fromValue = (value: string): ModelChoice => {
  const [modelProvider, model] = JSON.parse(value) as [string, string];
  return { modelProvider, model };
};

export function ModelPicker({
  listings,
  choice,
  onChoose,
}: {
  listings: ModelProviderListing[];
  choice: ModelChoice | undefined;
  onChoose: (choice: ModelChoice) => void;
}) {
  const available: { modelProvider: string; models: string[] }[] = [];
  const unavailable: { modelProvider: string; reason: string }[] = [];
  for (const listing of listings) {
    if (listing.status === "unavailable") unavailable.push(listing);
    else if (listing.models.length === 0) unavailable.push({ ...listing, reason: "it offers no Models" });
    else available.push(listing);
  }

  return (
    <div className="model-picker">
      {listings.length === 0 ? (
        <p role="alert">
          No Model Provider is configured, so a Review can't be started. Set <code>DIFFWISE_OLLAMA_URL</code> or{" "}
          <code>DIFFWISE_OPENAI_BASE_URL</code> and <code>DIFFWISE_OPENAI_API_KEY</code> (see the README), then restart
          Diffwise.
        </p>
      ) : available.length === 0 ? (
        <p role="alert">
          No Model Provider is available, so a Review can't be started. Check that each one below is running and
          configured correctly, and that it offers at least one Model.
        </p>
      ) : (
        <label>
          Model{" "}
          <select value={choice && toValue(choice)} onChange={(e) => onChoose(fromValue(e.target.value))}>
            {available.map((listing) => (
              <optgroup key={listing.modelProvider} label={listing.modelProvider}>
                {listing.models.map((model) => (
                  <option key={model} value={toValue({ modelProvider: listing.modelProvider, model })}>
                    {model}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}
      {unavailable.length > 0 && (
        <ul className="meta unavailable-providers">
          {unavailable.map((listing) => (
            <li key={listing.modelProvider}>
              {listing.modelProvider} is unavailable: {listing.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
