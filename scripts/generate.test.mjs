import assert from "node:assert/strict";
import { test } from "node:test";

import { generateEmojis, parseEmojiSelection } from "../src/server/generate.ts";

const config = { accountId: "account", gatewayId: "default", token: "test-secret" };
const completion = (emojis, finishReason = "stop") => ({
  choices: [{ finish_reason: finishReason, message: { content: JSON.stringify({ emojis }) } }],
});

test("catalog aliases collapse to one emoji and unsupported selections are removed", () => {
  const selection = { emojis: [" 🇷🇸 ", "words", "❤\uFE0E", "❤\uFE0E", "☭", "🐻", "🐻", "🐶🐱", "🦸‍🐱"] };
  assert.deepEqual(parseEmojiSelection(JSON.stringify(selection)), ["🇷🇸", "❤️", "🐻"]);
});

test("truncated or malformed completions fail instead of becoming empty results", async (t) => {
  const invalidJson = completion([]);
  invalidJson.choices[0].message.content = "not JSON";
  for (const reply of [completion(["🐶"], "length"), invalidJson, completion([1])]) {
    const mocked = t.mock.method(globalThis, "fetch", async () => Response.json(reply));
    await assert.rejects(generateEmojis(config, "dog"), { kind: "invalid_response" });
    mocked.mock.restore();
  }
});

test("response size limit applies across chunks even when JSON would otherwise be valid", async (t) => {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...completion(["🐶"]), padding: "x".repeat(70_000) }));
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 20_000) {
        controller.enqueue(bytes.subarray(offset, offset + 20_000));
      }
      controller.close();
    },
  })));
  await assert.rejects(generateEmojis(config, "dog"), { kind: "response_too_large" });
});
