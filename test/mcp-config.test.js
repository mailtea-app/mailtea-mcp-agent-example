import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const read = (file) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8"));

/** VS Code calls the map `servers`; everyone else calls it `mcpServers`. */
const CONFIGS = [
  { file: ".mcp.json", client: "Claude Code", key: "mcpServers" },
  { file: ".cursor/mcp.json", client: "Cursor", key: "mcpServers" },
  { file: ".vscode/mcp.json", client: "VS Code", key: "servers" },
  { file: "clients/claude-desktop.json", client: "Claude Desktop", key: "mcpServers" }
];

describe("MCP client configuration", () => {
  for (const { file, client, key } of CONFIGS) {
    describe(`${file} (${client})`, () => {
      const config = read(file);
      const servers = config[key];
      const mailtea = servers?.mailtea;

      it("declares exactly one server, named mailtea", () => {
        assert.ok(servers, `expected a "${key}" map`);
        assert.deepEqual(Object.keys(servers), ["mailtea"]);
      });

      it("runs the published mailtea-mcp package", () => {
        assert.equal(mailtea.command, "npx");
        assert.deepEqual(mailtea.args, ["-y", "mailtea-mcp"]);
      });

      it("passes the API key under the name the server reads", () => {
        // The server reads MAILTEA_API_TOKEN. Calling it MAILTEA_API_KEY here
        // fails silently: the server starts, and every tool call 401s.
        assert.ok(mailtea.env?.MAILTEA_API_TOKEN, "expected env.MAILTEA_API_TOKEN");
      });

      it("ships a placeholder, not a real key", () => {
        for (const value of Object.values(mailtea.env)) {
          assert.doesNotMatch(
            value,
            /mt_(pat|svc)_[a-z0-9]{16,}/i,
            "a real-looking Mailtea key is committed in this file"
          );
        }
      });
    });
  }
});
