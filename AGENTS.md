# AGENTS.md — openclaw-send-agent

This file is for agentic coding assistants working in this repository.

## Project Overview

An [OpenClaw](https://openclaw.ai) plugin that exposes a single agent tool,
`send_agent`, which zips a local agent folder and emails it as an attachment
via [gogcli](https://github.com/steipete/gogcli) (`gog gmail send --attach`).

**Stack:** Node >= 22, TypeScript (ESM), `@sinclair/typebox` for schemas,
OpenClaw Plugin SDK for tool registration, `zip` + `gog` CLI binaries at
runtime.

---

## Prerequisites

```bash
brew install gogcli     # provides the `gog` CLI
gog auth credentials ~/Downloads/client_secret_....json
gog auth add you@gmail.com  # authenticate once; token stored in keychain
```

`zip` must be in PATH (standard on macOS/Linux).

---

## Install & Reload

```bash
# From the openclaw-send-agent/ directory:
openclaw plugins install .
# Then restart the OpenClaw gateway for the plugin to load.
```

There is no build step. OpenClaw loads `index.ts` directly via its bundled
TypeScript runtime.

---

## Testing

No automated test suite exists yet. Manual testing steps:

1. Install the plugin (see above) and restart the gateway.
2. In an OpenClaw chat session, say:
   > "Send the agent in /path/to/some-agent-folder to you@example.com"
3. The `send_agent` tool should be invoked. Verify in Gmail that the email
   arrived with a `.zip` attachment.

To add tests in future, use the OpenClaw plugin test utilities documented at
https://docs.openclaw.ai/plugins/sdk-testing and run with:

```bash
pnpm test -- openclaw-send-agent/
```

---

## Code Style

### Imports

- Always use the `node:` protocol prefix for Node built-ins:
  ```ts
  import { execFile } from "node:child_process";
  import { join, basename } from "node:path";
  ```
- Import from focused OpenClaw SDK subpaths, never from the monolithic root:
  ```ts
  // correct
  import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
  // wrong — deprecated, will be removed
  import { definePluginEntry } from "openclaw/plugin-sdk";
  ```
- Third-party imports come after SDK imports, before Node built-ins.

### TypeScript

- All files use ESM (`"type": "module"` in `package.json`).
- No `any` — use `unknown` in catch blocks and narrow with `instanceof`:
  ```ts
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
  }
  ```
- Prefer `const` over `let`; avoid `var`.
- Use optional chaining and nullish coalescing (`??`) over explicit null checks.
- Use numeric separators for long timeouts: `60_000` not `60000`.

### Tool Parameters

Define all tool parameters with `@sinclair/typebox` `Type.*` helpers.
Always include a `description` on every field — the LLM reads these:

```ts
parameters: Type.Object({
  agentPath: Type.String({ description: "Absolute path to the agent folder" }),
  to:        Type.String({ description: "Recipient email address" }),
  account:   Type.Optional(Type.String({ description: "GOG account or alias" })),
})
```

### Tool Return Values

Always return `{ content: [{ type: "text", text: "..." }] }`.
On error, add `isError: true` and include a human-readable message:

```ts
return {
  content: [{ type: "text", text: `Error: ${msg}` }],
  isError: true,
};
```

Never throw from `execute` — always return an error object so the agent can
report it gracefully.

### Error Handling

- Validate preconditions early (folder exists, binary available) and return
  early with `isError: true` before allocating resources.
- Wrap resource allocation + use in `try/finally`; put cleanup in `finally`
  and swallow cleanup errors so they don't mask the original:
  ```ts
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  ```
- Set explicit `timeout` values on all `execFileAsync` calls.

### Naming Conventions

- Files: `camelCase.ts` for source, `kebab-case.json` for manifests.
- Variables/functions: `camelCase`.
- Tool names (registered with OpenClaw): `snake_case` (e.g. `send_agent`).
- Plugin/package IDs: `kebab-case`.

---

## Architecture

```
index.ts                  # sole entry point; calls definePluginEntry + registerTool
openclaw.plugin.json      # manifest: id, name, description, configSchema
package.json              # name must match manifest id; openclaw as peerDependency
```

The plugin has a single tool. To add more tools, call `api.registerTool(...)`
additional times inside the same `register(api)` function.

---

## Critical Constraints

- **ID consistency:** `package.json` `name`, `openclaw.plugin.json` `id`, and
  the `id` field passed to `definePluginEntry` must all match exactly.
  Mismatches cause load-time warnings and may prevent the plugin from loading.

- **peerDependency on openclaw:** Keep `"openclaw": "*"` in `peerDependencies`.
  Do NOT add it to `dependencies` — the runtime is provided by the host.

- **No bundling:** Do not add a build/bundle step. OpenClaw runs `index.ts`
  directly. Compiled output (`dist/`) is not used.

- **External binaries are optional tools:** Mark tools that require external
  binaries (like `gog`, `zip`) as `{ optional: true }` if you want users to
  explicitly opt in. Currently `send_agent` is required (always active).
