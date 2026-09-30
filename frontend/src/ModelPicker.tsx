import type { ModelChoice, ModelProviderListing } from "@diffwise/shared";

/** Splits the Model listing into the Model Providers a Model can be chosen from, and the rest with why not. */
function partition(listings: ModelProviderListing[]) {
  const usable: { modelProvider: string; models: string[] }[] = [];
  const unusable: { modelProvider: string; reason: string }[] = [];
  for (const listing of listings) {
    const { modelProvider } = listing;
    if (listing.status === "unavailable") unusable.push({ modelProvider, reason: listing.reason });
    else if (listing.models.length === 0) unusable.push({ modelProvider, reason: "it offers no Models" });
    else usable.push({ modelProvider, models: listing.models });
  }
  return { usable, unusable };
}

/** The first Model any Model Provider offers, to preselect in the dropdown. */
export function firstModel(listings: ModelProviderListing[]): ModelChoice | undefined {
  const [first] = partition(listings).usable;
  return first && { modelProvider: first.modelProvider, model: first.models[0]! };
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
  const { usable, unusable } = partition(listings);

  return (
    <div className="model-picker">
      {listings.length === 0 ? (
        <p role="alert">
          No Model Provider is configured, so a Review can't be started. Set <code>DIFFWISE_OLLAMA_URL</code> or{" "}
          <code>DIFFWISE_OPENAI_BASE_URL</code> and <code>DIFFWISE_OPENAI_API_KEY</code> (see the README), then restart
          Diffwise.
        </p>
      ) : usable.length === 0 ? (
        <p role="alert">
          No Model Provider is available, so a Review can't be started. Check that each one below is running and
          configured correctly, and that it offers at least one Model.
        </p>
      ) : (
        <label>
          Model{" "}
          <select value={choice && toValue(choice)} onChange={(e) => onChoose(fromValue(e.target.value))}>
            {usable.map((listing) => (
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
      {unusable.length > 0 && (
        <ul className="caption unavailable-providers">
          {unusable.map((listing) => (
            <li key={listing.modelProvider}>
              {listing.modelProvider} is unavailable: {listing.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
