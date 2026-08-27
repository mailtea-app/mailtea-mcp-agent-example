import { pathToFileURL } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

import { connectMailteaMcp } from "./mailtea-mcp.mjs";

// Node 20.12+ reads a .env file on its own, so the example runs with a plain
// `node agent.mjs` and no dotenv dependency. On older runtimes, export the
// variables yourself before running.
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file — the variables may already be in the environment.
  }
}

const MODEL = "claude-sonnet-5";

/**
 * The model half of the agent, behind a one-method interface so tests can swap
 * in a scripted response and exercise the tool plumbing with no Anthropic key.
 */
export function createClaudeModel({ client = new Anthropic(), model = MODEL } = {}) {
  return {
    async createMessage({ system, messages, tools }) {
      return client.messages.create({
        model,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system,
        messages,
        tools
      });
    }
  };
}

export function defaultSystemPrompt({ from, today = new Date().toISOString().slice(0, 10) }) {
  return [
    "You are an email operations agent with access to a Mailtea account.",
    `Send every email from: ${from}`,
    `Today is ${today}.`,
    "Use the Mailtea tools to carry out the request. Do not invent recipient",
    "addresses, subject lines, or figures — if the request does not supply a",
    "detail and no tool can look it up, say so instead of guessing.",
    "When you are done, report what you sent and the id the tool returned."
  ].join("\n");
}

/**
 * Runs the agent loop until the model stops asking for tools.
 *
 * `mcp` is anything with `{ tools, callTool }` — the real MCP connection in
 * production, a fake in a unit test.
 */
export async function runAgent({
  instruction,
  model,
  mcp,
  system,
  maxTurns = 8,
  onStep = () => {}
}) {
  const messages = [{ role: "user", content: instruction }];
  const toolCalls = [];

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const response = await model.createMessage({ system, messages, tools: mcp.tools });

    // Append the assistant turn verbatim. Thinking blocks carry signatures the
    // API validates on the next request, so re-serializing them would break it.
    messages.push({ role: "assistant", content: response.content });

    const requested = response.content.filter((block) => block.type === "tool_use");
    if (requested.length === 0) {
      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      return { text, toolCalls, stopReason: response.stop_reason };
    }

    // Claude may ask for several tools in one turn. Run them, then return every
    // result in a *single* user message — splitting them across messages
    // teaches the model to stop batching.
    const results = await Promise.all(
      requested.map(async (block) => {
        const { isError, text } = await mcp.callTool(block.name, block.input);
        toolCalls.push({ name: block.name, input: block.input, result: text, isError });
        onStep({ name: block.name, input: block.input, result: text, isError });

        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: text,
          ...(isError ? { is_error: true } : {})
        };
      })
    );

    messages.push({ role: "user", content: results });
  }

  throw new Error(`Agent did not finish within ${maxTurns} turns.`);
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  return value;
}

async function main() {
  const argv = process.argv.slice(2);
  const toolPrefixes = process.env.MAILTEA_MCP_TOOLS?.split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean);

  if (argv[0] === "--list-tools") {
    const mcp = await connectMailteaMcp({ token: required("MAILTEA_API_TOKEN") });
    for (const tool of mcp.available) console.log(tool.name);
    console.log(`\n${mcp.available.length} tools.`);
    await mcp.close();
    return;
  }

  const instruction = argv.join(" ").trim();
  if (!instruction) {
    console.error(
      'Usage: node agent.mjs "email you@yourdomain.com a one-line summary of today\'s signups"'
    );
    process.exitCode = 1;
    return;
  }

  const from = required("MAILTEA_FROM");
  const mcp = await connectMailteaMcp({
    token: required("MAILTEA_API_TOKEN"),
    ...(toolPrefixes ? { toolPrefixes } : {})
  });

  try {
    console.log(
      `${mcp.tools.length} of ${mcp.available.length} Mailtea tools given to the model.\n`
    );

    const { text } = await runAgent({
      instruction,
      model: createClaudeModel(),
      mcp,
      system: defaultSystemPrompt({ from }),
      onStep: ({ name, input, result, isError }) => {
        console.log(`${isError ? "x" : "→"} ${name} ${JSON.stringify(input)}`);
        console.log(`  ${result.split("\n")[0]}\n`);
      }
    });

    console.log(text);
  } finally {
    await mcp.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Anthropic and Mailtea failures both land here; print the message, never
    // the request (it carries the key).
    console.error(`Agent failed: ${error.message}`);
    process.exitCode = 1;
  });
}
