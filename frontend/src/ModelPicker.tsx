import { useEffect, useRef, useState } from "react";
import type { ModelChoice, ModelProviderListing } from "@diffwise/shared";
import { Button, ConnectionStatus, Menu, MenuGroup, MenuItem } from "./design-system/index.ts";

/** Splits the Model listing into the Model Providers a Model can be chosen from, and the rest with why not. */
function partition(listings: ModelProviderListing[]) {
  const usable: { modelProvider: string; models: string[] }[] = [];
  const unusable: { modelProvider: string; reason: string }[] = [];
  for (const listing of listings) {
    const { modelProvider } = listing;
    if (listing.status === "unavailable") unusable.push({ modelProvider, reason: listing.reason });
    else if (listing.models.length === 0) unusable.push({ modelProvider, reason: "it offers no Models." });
    else usable.push({ modelProvider, models: listing.models });
  }
  return { usable, unusable };
}

/** The first Model any Model Provider offers, to preselect in the Model menu. */
export function firstModel(listings: ModelProviderListing[]): ModelChoice | undefined {
  const [first] = partition(listings).usable;
  return first && { modelProvider: first.modelProvider, model: first.models[0]! };
}

/**
 * Where a Model is chosen for a Review: a button naming the chosen Model, opening a Menu of the Models each Model
 * Provider offers, with why any Model Provider can't be used.
 */
export function ModelPicker({
  listings,
  choice,
  onChoose,
}: {
  listings: ModelProviderListing[];
  choice: ModelChoice | undefined;
  onChoose: (choice: ModelChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const { usable, unusable } = partition(listings);

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  // Clicking anywhere else closes it, as leaving any menu does.
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!picker.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  if (listings.length === 0) {
    return (
      <p role="alert">
        No Model Provider is configured, so a Review can't be started. Set <code>DIFFWISE_OLLAMA_URL</code> or{" "}
        <code>DIFFWISE_OPENAI_BASE_URL</code> and <code>DIFFWISE_OPENAI_API_KEY</code> (see the README), then restart
        Diffwise.
      </p>
    );
  }
  if (usable.length === 0) {
    return (
      <div className="model-picker-unusable">
        <p role="alert">
          No Model Provider is available, so a Review can't be started. Check that each one below is running and
          configured correctly, and that it offers at least one Model.
        </p>
        <ul className="caption">
          {unusable.map((listing) => (
            <li key={listing.modelProvider}>
              {listing.modelProvider} is unavailable: {listing.reason}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div
      ref={picker}
      className="model-picker"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) close();
      }}
    >
      <Button
        ref={button}
        className="model-picker-button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="model-picker-choice">
          <span className="model-picker-label">Model</span> <code>{choice?.model}</code>
        </span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </Button>
      {open && (
        <Menu label="Choose a Model for this Review">
          {listings.map((listing) => {
            const { modelProvider } = listing;
            const reason = unusable.find((other) => other.modelProvider === modelProvider)?.reason;
            return (
              <MenuGroup
                key={modelProvider}
                label={modelProvider}
                aside={
                  listing.status === "available" ? (
                    <ConnectionStatus status="ok">Connected</ConnectionStatus>
                  ) : (
                    <ConnectionStatus status="error">Unavailable</ConnectionStatus>
                  )
                }
                note={reason && `${reason[0]!.toUpperCase()}${reason.slice(1)}`}
              >
                {listing.status === "available" &&
                  listing.models.map((model) => (
                    <MenuItem
                      key={model}
                      selected={choice?.modelProvider === modelProvider && choice.model === model}
                      onClick={() => {
                        onChoose({ modelProvider, model });
                        close();
                      }}
                    >
                      {model}
                    </MenuItem>
                  ))}
              </MenuGroup>
            );
          })}
        </Menu>
      )}
    </div>
  );
}
