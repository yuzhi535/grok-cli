# PI Model Import for gork

## Goal

Import the locally configured PI model catalog into gork without changing the
upstream model runtime or touching Grok Build's `~/.grok` state.

## Design

`scripts/import-pi-models.mjs` reads the two PI catalog files
(`~/.pi/agent/models.json` and `~/.pi/agent/models-store.json`) and rewrites
only a marked block in gork's `config.toml`. The target is `$GORK_HOME/config.toml`
or `~/.gork/config.toml` when that variable is absent.

The importer emits OpenAI-compatible custom-model requests for every PI model:

- `anthropic-messages` -> `chat_completions` (compatibility mode)
- `openai-completions` -> `chat_completions`
- `openai-responses` and `openai-codex-responses` -> `responses`

The compatibility mode deliberately retains PI's original URL and model ID.
Those values cannot be safely inferred from a differently configured provider;
the selected endpoints are expected to accept OpenAI Chat Completions.

**OpenAI Codex (ChatGPT OAuth)** models (`api = openai-codex-responses`,
provider `openai-codex`) are special-cased to match PI's runtime:

- `base_url` stays `https://chatgpt.com/backend-api` (sampler rewrites the
  path to `/codex/responses`, injects `chatgpt-account-id` from the JWT, and
  sets `OpenAI-Beta: responses=experimental` / `originator: gcode`)
- models get `auth_provider = "openai-codex"` instead of a static API key
- the importer installs `scripts/gcode-openai-codex-auth` into
  `$GCODE_HOME/bin` and emits a matching `[auth_provider.openai-codex]`
  table (same OAuth client id + refresh flow as PI / Codex CLI)

It preserves model identifiers, display names, base URLs, context limits,
completion limits, and available API keys. API keys are written only to the
local target config, never printed, checked into Git, or placed in test data.
Provider entries without an API key are still imported, so any externally
supplied credential remains usable.

The PI default model is mapped to gork's `[models].default` when the matching
model is imported. Running the importer again replaces its own generated block
and leaves all other gork configuration unchanged.

## Validation

A Node test uses sanitized fixture data to verify protocol/auth mapping,
default-model mapping, idempotent block replacement, and the absence of API
keys in command output. The real import is run only after that test passes.
