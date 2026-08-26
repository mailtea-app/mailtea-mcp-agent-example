import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";

import { runAgent } from "../agent.mjs";
import { connectMailteaMcp } from "../mailtea-mcp.mjs";
import { startMockMailtea } from "./mock-mailtea.mjs";

const FROM = "Acme <hello@acme.com>";
const TO = "reader@mailtea.test";

/**
 * A model that replays a scripted list of responses. The point of these tests
 * is the wiring between a `tool_use` block and a real HTTP request, so the one
 * part that needs a paid API key is the one part that gets stubbed.
 */
function stubModel(responses) {
  const calls = [];
  return {
    calls,
    async createMessage(request) {
      // Snapshot: the agent keeps appending to the same messages array, so
      // holding the reference would show the conversation as it ended, not as
      // it was on this turn.
      calls.push({ ...request, messages: [...request.messages] });
      const next = responses[calls.length - 1];
      if (!next) throw new Error(`stub model ran out of responses after ${calls.length}`);
      return next;
    }
  };
}

const toolUse = (name, input) => ({
  content: [{ type: "tool_use", id: "toolu_01", name, input }],
  stop_reason: "tool_use"
});

const finalText = (text) => ({
  content: [{ type: "text", text }],
  stop_reason: "end_turn"
});

describe("Mailtea + MCP agent", () => {
  let mock;
  let mcp;

  before(async () => {
    mock = await startMockMailtea();

    // The real mailtea-mcp server, spawned from node_modules and pointed at the
    // mock API. Nothing here is faked except the model and the Mailtea backend.
    mcp = await connectMailteaMcp({
      command: process.execPath,
      args: [fileURLToPath(import.meta.resolve("mailtea-mcp/stdio"))],
      token: "mt_pat_test_key",
      baseUrl: mock.url
    });
  });

  after(async () => {
    await mcp?.close();
    await mock?.close();
  });

  beforeEach(() => {
    mock.requests.length = 0;
  });

  it("exposes email.send under a name the Messages API accepts", () => {
    const send = mcp.tools.find((tool) => tool.name === "email__send");
    assert.ok(send, `email.send missing from ${mcp.tools.map((t) => t.name).join(", ")}`);
    assert.match(send.name, /^[a-zA-Z0-9_-]{1,128}$/);
    assert.ok(send.input_schema.properties.subject, "expected the real input schema");
  });

  it("turns a tool_use block into POST /v1/emails", async () => {
    const model = stubModel([
      toolUse("email__send", {
        from: FROM,
        to: TO,
        subject: "Today's signups",
        html: "<p>42 new subscribers today.</p>"
      }),
      finalText("Sent the signup summary.")
    ]);

    const result = await runAgent({
      instruction: `Email ${TO} a summary of today's signups.`,
      model,
      mcp,
      system: "test"
    });

    // 1. The request reached the send endpoint.
    const sent = mock.last;
    assert.equal(sent.method, "POST");
    assert.equal(sent.path, "/v1/emails");

    // 2. It was authenticated.
    assert.equal(sent.authorization, "Bearer mt_pat_test_key");

    // 3. The model's arguments arrived intact.
    assert.deepEqual(sent.body, {
      from: FROM,
      to: TO,
      subject: "Today's signups",
      html: "<p>42 new subscribers today.</p>"
    });

    // 4. The email id came back to the model, and the agent finished.
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].isError, false);
    assert.match(result.toolCalls[0].result, /txemail_0{32}/);
    assert.equal(result.text, "Sent the signup summary.");

    // The tool result was fed back as a user turn before the final answer.
    assert.equal(model.calls.length, 2);
    const [followUp] = model.calls[1].messages.slice(-1);
    assert.equal(followUp.role, "user");
    assert.equal(followUp.content[0].type, "tool_result");
    assert.equal(followUp.content[0].tool_use_id, "toolu_01");
  });

  it("cancels through the route the API actually defines", async () => {
    // Cancel is POST /v1/emails/:id/cancel — there is no DELETE on emails. A
    // mock that answers the wrong verb turns a working tool into a 404 and
    // teaches the reader an endpoint that does not exist.
    const id = "txemail_00000000000000000000000000000000";
    const { isError } = await mcp.callTool("email__cancel", { id });

    assert.equal(isError, false);
    assert.equal(mock.last.method, "POST");
    assert.equal(mock.last.path, `/v1/emails/${id}/cancel`);
  });

  it("hands a rejected call back to the model as an errored tool result", async () => {
    const model = stubModel([
      // No `from` and no `sender_id` — the MCP server refuses this before it
      // reaches the API, and reports it as a JSON-RPC error rather than a
      // result. It still has to arrive as a tool_result the model can act on.
      toolUse("email__send", { to: TO, subject: "Oops", html: "<p>no sender</p>" }),
      finalText("I need a verified sender address.")
    ]);

    const result = await runAgent({ instruction: "Send it.", model, mcp, system: "test" });

    assert.equal(mock.requests.length, 0, "nothing should have been sent");
    assert.equal(result.toolCalls[0].isError, true);
    assert.match(result.toolCalls[0].result, /exactly one of 'from' or 'sender_id'/);

    const [followUp] = model.calls[1].messages.slice(-1);
    assert.equal(followUp.content[0].is_error, true);
  });
});
