# The Diffwise design system artifact is the source of truth, and the frontend ports it

How Diffwise looks is defined by the "Diffwise" Design System artifact on claude.ai (https://claude.ai/artifact/2gJVELCqdqBcpc5thQwVJD): its tokens, fonts, component guidelines and voice. The frontend ports it rather than importing it: the artifact's `tokens.json` is kept in the repo unedited and the CSS variables are generated from it at build time, the IBM Plex font files are copied in, and its components are rebuilt as React components that follow its guidelines. When the artifact and Diffwise disagree, the artifact is corrected, never quietly diverged from, so it stays one reference that people and agents can build on.

## Considered Options

- **Import the artifact's component bundle**: it's a classic script that assigns `window.Diffwise` and targets React 18, while the frontend is React 19 with ES modules. Wrapping it would mean a second React or a global-script shim, for four small components.
- **Publish it as a workspace package**: overkill with one consumer.
- **Hand-write the CSS variables**: about 30 colour tokens across two themes would drift from the artifact unnoticed. Generating them from the unedited `tokens.json` means syncing is replacing one file, and the git diff shows what changed.
- **Treat the artifact as a starting point and let the code diverge**: every agent that later reads the artifact would build what it describes, including things Diffwise deliberately doesn't do.

## Consequences

- Syncing is manual: copy the artifact's `tokens.json` (and fonts, if they change) into the repo. Nothing fetches it automatically, because reading the artifact needs a claude.ai session.
- A UI change the design system doesn't cover starts with a change to the artifact, then the port.
- The artifact speaks the language of `CONTEXT.md` (Finding, Bad Practice, Security Issue, Suggested Fix), since its words become the words the next agent uses.
