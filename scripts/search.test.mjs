import assert from "node:assert/strict";
import { test } from "node:test";

import app from "../src/server/index.ts";

function environment() {
  const entries = new Map();
  const writes = [];
  return {
    entries, writes,
    env: {
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_AI_GATEWAY_ID: "default",
      CLOUDFLARE_AI_GATEWAY_TOKEN: "test-secret",
      RATE_LIMITER: { limit: async () => ({ success: true }) },
      EMOJI_CACHE: {
        get: async (key) => entries.has(key) ? JSON.parse(entries.get(key)) : null,
        put: async (key, value, options) => { entries.set(key, value); writes.push({ key, options }); },
      },
    },
  };
}

const search = (env, query) => app.request(`/api/emojis/search?query=${encodeURIComponent(query)}`, {}, env);
const completion = (emojis) => Response.json({
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ emojis }) } }],
});

test("search normalizes cache keys, skips old caches, and caches filtered results for seven days", async (t) => {
  const { env, writes, entries } = environment();
  entries.set("matches:dog", JSON.stringify([{ id: "wrong" }]));
  entries.set("search:dog", JSON.stringify(["wrong"]));
  entries.set("search:groq-gpt-oss-120b-v1:emojilib-4.0.2:dog", JSON.stringify(["wrong"]));
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++;
    assert.equal(JSON.parse(options.body).messages[1].content, "dog");
    return completion(["🐶", "prose", "🐶", "🐱"]);
  });
  for (const query of [" DOG ", "dog"]) {
    const response = await search(env, query);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, emojis: ["🐶", "🐱"] });
  }
  assert.equal(calls, 1);
  assert.equal(writes.length, 1);
  assert.match(writes[0].key, /^search:[a-f0-9]{64}:dog$/);
  assert.equal(writes[0].options.expirationTtl, 604800);
});

test("empty successful selections are cache hits", async (t) => {
  const { env } = environment();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return completion([]); });
  for (let index = 0; index < 2; index++) {
    assert.deepEqual(await (await search(env, "unknown")).json(), { ok: true, emojis: [] });
  }
  assert.equal(calls, 1);
});

test("upstream failure returns safe JSON and is not cached", async (t) => {
  const { env, writes } = environment();
  t.mock.method(console, "error", () => {});
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return calls === 1 ? new Response("private provider error", { status: 401 }) : completion(["🐶"]);
  });
  const failed = await search(env, "dog");
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { ok: false, error: { code: "SEARCH_UNAVAILABLE" } });
  assert.equal(writes.length, 0);
  assert.deepEqual(await (await search(env, "dog")).json(), { ok: true, emojis: ["🐶"] });
  assert.equal(calls, 2);
});

test("invalid queries and rate limits reject before provider calls", async (t) => {
  const { env } = environment();
  const mocked = t.mock.method(globalThis, "fetch", () => { throw new Error("must not call provider"); });
  for (const [query, code] of [["", "INVALID_QUERY"], ["   ", "INVALID_QUERY"], ["x".repeat(81), "QUERY_TOO_LONG"]]) {
    const response = await search(env, query);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, code);
  }
  env.RATE_LIMITER.limit = async () => ({ success: false });
  const response = await search(env, "dog");
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, "RATE_LIMIT_EXCEEDED");
  assert.equal(mocked.mock.callCount(), 0);
});
