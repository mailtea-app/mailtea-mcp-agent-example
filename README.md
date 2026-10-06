# Mailtea + MCP (AI agents) Example

This example shows how to use [Mailtea](https://mailtea.app) with the Model
Context Protocol to give an AI agent the ability to send email: paste a config
into your coding agent, or run the included Claude agent that turns a plain
instruction like "email dave@acme.com a summary of today's signups" into a real
send.

It has two halves that are useful independently:

1. **Client configuration** — drop-in MCP server config for Claude Code, Claude
   Desktop, Cursor, and VS Code. No code.
2. **`agent.mjs`** — a runnable agent that gives Claude the same MCP tools and
   drives the tool loop itself (about 50 lines of loop), for when the agent is
   your product rather than your editor.

## Prerequisites

To get the most out of this guide, you'll need to:

- [Create an API key](https://studio.mailtea.app/api-keys)
- [Verify your domain](https://docs.mailtea.app/docs/documentation/domains)
- An [Anthropic API key](https://console.anthropic.com), for `agent.mjs` only

## Instructions

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and add your API key:
   ```bash
   cp .env.example .env
   ```
3. Run it:
   ```bash
   npm start -- "email reader@your-domain.com a one-line hello from the MCP example"
   ```

To see every tool your key can reach:

```bash
npm run tools
```

## Connecting your own agent

Every client below runs the same command — `npx -y mailtea-mcp` — and differs
only in where the file goes and how it spells the config.

| Client | File in this repo | Where it goes |
| --- | --- | --- |
| Claude Code | `.mcp.json` | project root (already in place) |
| Cursor | `.cursor/mcp.json` | project root, or `~/.cursor/mcp.json` for all projects |
| VS Code | `.vscode/mcp.json` | workspace root |
| Claude Desktop | `clients/claude-desktop.json` | merge into `claude_desktop_config.json` (Settings → Developer → Edit Config) |

The minimum config is four lines:

```json
{
  "mcpServers": {
    "mailtea": {
      "command": "npx",
      "args": ["-y", "mailtea-mcp"],
      "env": { "MAILTEA_API_TOKEN": "mt_pat_xxxxxxxx" }
    }
  }
}
```

Two things worth knowing:

- **The variable is `MAILTEA_API_TOKEN`**, not `MAILTEA_API_KEY`. Mailtea's REST
  and SDK examples use `MAILTEA_API_KEY`; the MCP server reads
  `MAILTEA_API_TOKEN`. Get it wrong and the server starts fine — every tool
  call just 401s.
- **Key spans several publications?** Add `MAILTEA_PUBLICATION_ID` to the same
  `env` block to pin the agent to one.

Claude Code can also add it in one command, without a file:

```bash
claude mcp add mailtea -e MAILTEA_API_TOKEN=mt_pat_xxxxxxxx -- npx -y mailtea-mcp
```

Never commit a real key. `.mcp.json` here reads `${MAILTEA_API_TOKEN}` from your
environment and `.vscode/mcp.json` prompts for it, so neither stores one.

## Available tools

The server exposes **165 tools**. This is the full catalog, grouped by family.
Prefix each name with its family, so `send` under `email.*` is `email.send`.

| Family | Tools |
| --- | --- |
| `auth.*` | `me` |
| `email.*` | `send`, `batch`, `get`, `list`, `analytics`, `reschedule`, `cancel`, `resend`, `lint`, `inbound_list`, `inbound_get`, `inbound_list_attachments`, `inbound_get_attachment`, `inbound_reply` |
| `issue.*` | `create_draft`, `get_editor`, `apply_ops`, `update_draft`, `remove_draft`, `list_recent`, `preview`, `preview_draft`, `delivery_progress`, `wait_delivery`, `schedule`, `unschedule`, `publish_to_web`, `unpublish_from_web`, `send_now`, `send_and_wait`, `send_test` |
| `contact.*` | `list`, `get`, `upsert`, `delete`, `set_status`, `import_csv`, `get_properties`, `set_properties`, `referral_summary`, `referral_milestones`, `referral_milestone_upsert`, `referral_milestone_remove`, `referral_rewards` |
| `contact_property.*` | `create`, `list`, `update`, `delete` |
| `segment.*` | `create`, `list`, `get`, `update`, `delete` |
| `topic.*` | `create`, `list`, `update`, `delete` |
| `suppression.*` | `search`, `export`, `add`, `remove` |
| `template.*` | `create`, `list`, `get`, `update`, `publish`, `unpublish`, `versions`, `restore_version`, `duplicate`, `delete`, `render` |
| `sender.*` | `list`, `create`, `update`, `set_default`, `delete` |
| `domain.*` | `create`, `list`, `get`, `verify`, `update`, `delete`, `claim`, `claim_get`, `claim_verify`, `claim_cancel`, `tracking_create`, `tracking_list`, `tracking_verify`, `tracking_delete` |
| `publication.*` | `list`, `create`, `domain_list`, `domain_upsert`, `domain_verify`, `domain_set_primary`, `domain_remove`, `domain_traefik_preview` |
| `automation.*` | `create`, `list`, `get`, `update`, `validate`, `enable`, `disable`, `archive`, `delete`, `versions`, `version`, `metrics` |
| `automation_run.*` | `list`, `get`, `cancel` |
| `event.*` | `send` |
| `event_definition.*` | `list`, `get`, `create`, `update`, `delete` |
| `analytics.*` | `poll_results`, `issue_performance`, `issue_trend`, `latest_summary`, `issue_export_csv`, `issue_export_performance_csv`, `issue_export_polls_csv` |
| `webhook.*` | `create`, `list`, `get`, `update`, `delete` |
| `api_key.*` | `create`, `list`, `revoke` |
| `site.*` | `get`, `pages_list`, `page_get`, `page_upsert`, `apply_ops`, `footer_templates_list`, `navbar_templates_list`, `section_templates_list`, `design_brief_get`, `design_brief_set`, `publish`, `discard_draft`, `asset_list`, `asset_upload`, `asset_delete` |
| `section.*` | `list`, `catalog`, `create`, `update`, `remove`, `pack_create`, `pack_update`, `pack_remove`, `pack_revisions`, `pack_restore_revision`, `import_pack` |
| `monetize.*` | `offer_list`, `offer_upsert`, `offer_remove` |

`npm run tools` prints this list live from your own key, which is the version
to trust.

The server also serves resources (`mailtea://capabilities`,
`publication://current/brand-guidelines`,
`mailtea://automations/step-types`, …) and prompts
(`newsletter.draft_from_brief`, `newsletter.subject_line_pack`).

## What this example covers

- Configuring `mailtea-mcp` as a stdio MCP server in four different clients
- Connecting to it from code with `@modelcontextprotocol/sdk` and turning its
  tools into Anthropic Messages API tool definitions
- Running the tool loop against `claude-sonnet-5`: `tool_use` in, tool result
  back, until the model stops asking
- Sending a real email through `email.send` from a natural-language instruction
- Keeping the model client injectable, so the tool plumbing is testable with no
  Anthropic key

## Three things that are easy to get wrong

**Tool names.** Anthropic tool names must match `^[a-zA-Z0-9_-]{1,128}$`; every
Mailtea tool has a dot in it. `mailtea-mcp.mjs` renames `email.send` to
`email__send` on the way out and restores it on the way in, so neither side ever
sees the other's spelling.

**Tool count.** All 162 schemas is a large prompt to pay for on every turn. The
agent asks for a slice by prefix (`email.`, `contact.`, `topic.` by default;
override with `MAILTEA_MCP_TOOLS`).

**Failed tool calls.** Mailtea reports tool failures as JSON-RPC errors, so the
MCP client *throws* rather than returning a result. Catch it and feed it back as
a `tool_result` with `is_error: true` — the model then fixes its own arguments,
which is the behaviour you actually want. Dropping the result instead leaves the
conversation with a `tool_use` block that has no answer, and the next request is
rejected.

### stdio, not the MCP connector

Anthropic's [MCP connector](https://docs.anthropic.com/en/docs/agents-and-tools/mcp-connector)
lets the API talk to a *remote* MCP server over HTTP, so it can't launch a local
process that holds your key. This example uses a stdio client instead. If you
would rather the model connect directly, Mailtea also serves remote MCP at
`https://api.mailtea.app/mcp` with `Authorization: Bearer <your key>`.

## Tests

```bash
npm test
```

The tests run against a bundled mock Mailtea server, so they need no API key
and make no network calls. They start the real `mailtea-mcp` server from
`node_modules`, point it at the mock, and drive `runAgent` with a stub model
that returns a scripted `tool_use` block — proving that a model's tool call
becomes an authenticated `POST /v1/emails` with the right body, and that a
rejected call comes back as an errored tool result rather than a send.

## Learn more

- [Documentation](https://docs.mailtea.app)
- [API reference](https://docs.mailtea.app/docs/api-reference)
- [Node.js SDK](https://github.com/mailtea-app/mailtea-node) ·
  [Python SDK](https://github.com/mailtea-app/mailtea-python) ·
  [MCP server](https://github.com/mailtea-app/mailtea-mcp)
