# AGENTS.md

Guidance for AI coding agents working in this repository. Follows the
[AGENTS.md](https://agents.md) open standard. Human contributors: see
[`README.md`](./README.md) for usage.

## What this is

`@webhookrelay/sdk` — the official TypeScript/JavaScript SDK for the
[Webhook Relay](https://webhookrelay.com) API. It manages buckets, inputs,
outputs, service connections and JavaScript transformation functions, and
receives webhooks by polling or over a WebSocket. It ships as a dual ESM+CJS
package with type declarations and works in Node.js (≥ 18), Deno, Bun and the
browser.

## Where the API is

- **Live API:** `https://my.webhookrelay.com`, all endpoints under `/v1`
  (e.g. `GET /v1/buckets`, `POST /v1/functions`, `GET /v1/events`,
  `wss://my.webhookrelay.com/v1/socket`). This is `DEFAULT_BASE_URL` in
  [`src/config.ts`](./src/config.ts).
- **OpenAPI/Swagger spec:** [`swagger/swagger.yaml`](./swagger/swagger.yaml) —
  the source of truth for endpoints and models. Refresh it from the backend
  with `make swagger` (copies `SWAGGER_SRC`, default
  `../../rusenask/webhookrelay/frontend/swagger/swagger.yaml`).
- **Backend source of truth:** the Go server in `../../rusenask/webhookrelay`
  (handlers in `api/`, structs in `structs/`). Its `make openapi` generates the
  swagger consumed here. When an endpoint's behavior is unclear, read the Go
  handler rather than guessing.
- **Generated low-level client:** [`src/generated/api.ts`](./src/generated/api.ts)
  — auto-generated from the swagger by `make openapi` (swagger-typescript-api),
  post-processed with `@ts-nocheck`. Exposed to users as
  `@webhookrelay/sdk/generated`. Do not hand-edit; it is regenerated.

## Where the docs are

- [`README.md`](./README.md) — user-facing usage for every feature.
- [`examples/`](./examples/) — runnable end-to-end examples (manage buckets,
  poll, subscribe over WebSocket).
- Public product docs: https://webhookrelay.com/docs/
- REST API reference: https://webhookrelay.com/docs/api/
- This file (`AGENTS.md`) + [`CLAUDE.md`](./CLAUDE.md) — agent guidance.

## Project structure

```
src/
  index.ts            Public barrel — the only entry users import from.
  client.ts           WebhookRelay class; wires resources + streaming.
  config.ts           Credential resolution (apiKey / key+secret / env) + base URL.
  http.ts             HttpClient: fetch wrapper (auth, query, JSON, errors, timeout).
  errors.ts           WebhookRelayError hierarchy (API / Connection / Config).
  types.ts            Public data model (Bucket, Input, Output, Function, …).
  params.ts           camelCase → snake_case param normalization.
  resources/          One class per resource, hung off the client:
    buckets.ts inputs.ts outputs.ts serviceConnections.ts functions.ts webhooks.ts
  streaming/
    poller.ts         WebhookPoller — async-iterable pull delivery over /v1/events.
    socket.ts         WebhookSubscription — real-time push over /v1/socket.
    websocket.ts      Isomorphic WebSocket resolver + URL helper.
  generated/api.ts    Generated low-level client (do not edit).
test/                 Vitest suite (mock fetch + fake WebSocket; no network).
examples/             Runnable usage examples.
swagger/swagger.yaml  OpenAPI spec (input to `make openapi`).
scripts/              Build/codegen helpers (postprocess-generated.mjs).
```

Architecture: a **hand-written ergonomic facade** (`src/`) over a **generated
low-level client** (`src/generated`). The facade is the supported surface; the
generated client is a raw escape hatch. They share the swagger as source of truth.

## Style & conventions

- **Language:** TypeScript, `strict` + `noUncheckedIndexedAccess`. ESM-first
  with **explicit `.js` extensions** in relative imports (e.g.
  `import { HttpClient } from "./http.js"`) — required for NodeNext ESM; tsup
  and Vitest resolve them to `.ts`.
- **Data model naming:** public types mirror the API JSON **snake_case** exactly
  (no translation layer when reading responses). For request params, both
  `snake_case` and `camelCase` are accepted and normalized to snake_case on the
  wire by `params.ts` — keep both spellings in `Create*Params`/`Update*Params`
  types when adding fields, and add the alias to the relevant map in `params.ts`.
- **Resources:** each is a small class taking `HttpClient` (and `ResolvedConfig`
  where streaming is involved). Methods return typed promises. Always
  `encodeURIComponent(...)` path segments. Nested resources (inputs/outputs) take
  `bucketId` as the first argument.
- **Errors:** never throw raw errors from the HTTP layer — map to
  `WebhookRelayAPIError` (non-2xx) or `WebhookRelayConnectionError` (network/
  timeout). All extend `WebhookRelayError`.
- **Isomorphic:** rely on global `fetch` (Node ≥ 18) and global `WebSocket`
  (browser/Deno/Node ≥ 21), lazily importing `ws` only when no global exists.
  Never add Node-only APIs to the runtime path without a fallback. Keep runtime
  dependencies at zero (`ws` is an optional dependency).
- **Docs:** every public class/method has a JSDoc comment, usually with a short
  usage example. Match the surrounding density when editing.

## Commands

```bash
npm install          # or: make install
npm run build        # tsup → dist/ (ESM + CJS + .d.ts)
npm run typecheck    # tsc --noEmit  (MUST pass — esbuild-based tests do not typecheck)
npm test             # vitest run
npm run test:coverage
make openapi         # regenerate src/generated/api.ts from swagger/swagger.yaml
make swagger         # refresh swagger/swagger.yaml from the backend (SWAGGER_SRC)
```

Before committing, run **`npm run typecheck && npm test && npm run build`**.
Tests passing is not enough on their own: Vitest uses esbuild and does **not**
typecheck, and the `dts` build can fail where `tsc` does — so always run the
typecheck and the full build too.

## Testing

- Vitest, fully offline: `test/helpers.ts` provides a mock `fetch`; the socket
  test drives a fake WebSocket. No live API calls in the suite.
- When adding a resource method or param alias, add/extend a test asserting the
  HTTP method, path, and (normalized) body/query.
- Live end-to-end checks against `my.webhookrelay.com` are done manually with a
  real key in `.env` (`RELAY_API_KEY` or `RELAY_KEY`+`RELAY_SECRET`); `.env` is
  gitignored — never commit credentials.

## Build, publish & release

- **Build:** tsup emits ESM (`.js`), CJS (`.cjs`) and declarations for two
  entries: the root and `./generated`. Config in `tsup.config.ts`; `ws` is
  marked external.
- **Published files:** only `dist/`, `README.md`, `LICENSE` (`files` allowlist
  in `package.json`).
- **Releases:** npm **Trusted Publishing (OIDC)** via
  `.github/workflows/npm-publish.yml` — triggered on a GitHub Release, no token
  or OTP, provenance enabled. Bump with `npm version`, push the tag, create the
  release; CI publishes. Do not hand-publish from a laptop except for bootstrap.
- The developers team (`webhookrelay:developers`) has read-write on the package.

## Working agreement

- The default branch is `main`; push directly to `main` while iterating (no PRs
  for now, per the maintainer).
- Publishing to npm is outward-facing and irreversible — confirm with the
  maintainer before running any real `npm publish` / release.
- Don't commit `.env`, `dist/`, `node_modules/` or `coverage/` (all gitignored).
