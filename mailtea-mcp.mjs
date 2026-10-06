import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment
} from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * The Mailtea MCP server exposes 162 tools. Sending every schema on every turn
 * is a large, mostly irrelevant prompt, so the agent asks for a slice by dotted
 * prefix. Widen it when the task needs more (`domain.`, `automation.`, `site.`…).
 */
const DEFAULT_TOOL_PREFIXES = ["email.", "contact.", "topic."];

/**
 * Anthropic tool names must match `^[a-zA-Z0-9_-]{1,128}$`, and every Mailtea
 * tool has a dot in it (`email.send`). Rename on the way out and restore on the
 * way back, so the model never sees a dotted name and the server never sees an
 * underscored one. A double underscore keeps the mapping unambiguous for tools
 * that already contain a single one (`contact_property.list`).
 */
const toModelName = (mcpName) => mcpName.replaceAll(".", "__");

/**
 * Starts `mailtea-mcp` over stdio and returns its tools in the shape the
 * Messages API wants.
 *
 * stdio rather than the Anthropic MCP connector: the connector reaches out to a
 * remote MCP server over HTTP, so it cannot launch a local process holding your
 * key. Mailtea does serve remote MCP at `<base>/mcp` if you would rather the
 * model connect directly — see the README.
 */
export async function connectMailteaMcp({
  command = "npx",
  args = ["-y", "mailtea-mcp"],
  token = process.env.MAILTEA_API_TOKEN,
  baseUrl = process.env.MAILTEA_API_BASE_URL,
  publicationId = process.env.MAILTEA_PUBLICATION_ID,
  toolPrefixes = DEFAULT_TOOL_PREFIXES
} = {}) {
  const transport = new StdioClientTransport({
    command,
    args,
    // The child process gets a deliberately small environment: the MCP SDK's
    // safe default (PATH, HOME, …) plus exactly the Mailtea variables. Nothing
    // else in your shell leaks into a server you did not write.
    env: {
      ...getDefaultEnvironment(),
      ...(token ? { MAILTEA_API_TOKEN: token } : {}),
      ...(baseUrl ? { MAILTEA_API_BASE_URL: baseUrl } : {}),
      ...(publicationId ? { MAILTEA_PUBLICATION_ID: publicationId } : {})
    },
    stderr: "inherit"
  });

  const client = new Client({ name: "mailtea-agent-example", version: "1.0.0" });
  await client.connect(transport);

  const { tools: available } = await client.listTools();
  const selected = available.filter((tool) =>
    toolPrefixes.some((prefix) => tool.name.startsWith(prefix))
  );

  if (selected.length === 0) {
    await client.close();
    throw new Error(
      `No Mailtea MCP tools matched ${toolPrefixes.join(", ")}. The server offers ${available.length}.`
    );
  }

  const mcpNameByModelName = new Map(
    selected.map((tool) => [toModelName(tool.name), tool.name])
  );

  return {
    /** Every tool the server offers, unfiltered — useful for discovery. */
    available,

    /** Tool definitions in Anthropic Messages API shape. */
    tools: selected.map((tool) => ({
      name: toModelName(tool.name),
      description: tool.description,
      input_schema: tool.inputSchema
    })),

    /**
     * Runs one tool and returns text for a `tool_result` block.
     *
     * Mailtea reports a failed tool (a rejected send, a bad argument) as a
     * result with `isError`, its reason in the first text block. A protocol
     * failure, such as an unknown tool, still makes the MCP client throw.
     * Both become an errored tool result, because the model fixing its own
     * arguments on the next turn is the whole point.
     */
    async callTool(modelName, input) {
      const name = mcpNameByModelName.get(modelName);
      if (!name) return { isError: true, text: `Unknown tool: ${modelName}` };

      try {
        const result = await client.callTool({ name, arguments: input ?? {} });
        const blocks = (result.content ?? [])
          .filter((block) => block.type === "text")
          .map((block) => block.text);
        // The server already sends the data as a JSON text block beside
        // structuredContent, except for very large data and older servers, so
        // the structured copy is added only when the text lacks it.
        const structured = result.structuredContent
          ? JSON.stringify(result.structuredContent)
          : "";
        const text = [...blocks, ...(structured && !blocks.includes(structured) ? [structured] : [])]
          .filter(Boolean)
          .join("\n");

        return {
          isError: Boolean(result.isError),
          text: text || "(no output)"
        };
      } catch (error) {
        // Never return an empty string: a `tool_result` with no content is
        // rejected by the Messages API, which would turn a recoverable tool
        // failure into a dead conversation.
        return { isError: true, text: error?.message || String(error) };
      }
    },

    async close() {
      await client.close();
    }
  };
}
