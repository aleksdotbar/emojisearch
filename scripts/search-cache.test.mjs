import assert from "node:assert/strict";
import { test } from "node:test";
import emojilib from "emojilib" with { type: "json" };

import {
  GENERATION_SETTINGS,
  deriveSearchCacheVersion,
  getSearchCacheVersion,
} from "../src/server/generate.ts";

test("cache identity follows model, prompt, settings, and response schema changes", async () => {
  const emojis = ["🐶", "🐱"];
  const original = await deriveSearchCacheVersion(GENERATION_SETTINGS, emojis, 1);
  const changes = [
    ["model", (settings) => { settings.model = "another-model"; }],
    ["prompt", (settings) => { settings.messages[0].content += " Changed instructions."; }],
    ["reasoning effort", (settings) => { settings.reasoning_effort = "medium"; }],
    ["temperature", (settings) => { settings.temperature = 0.5; }],
    ["token limit", (settings) => { settings.max_completion_tokens = 1000; }],
    ["streaming", (settings) => { settings.stream = true; }],
    ["schema strictness", (settings) => { settings.response_format.json_schema.strict = false; }],
    ["response schema", (settings) => {
      settings.response_format.json_schema.schema.properties.emojis.maxItems = 20;
    }],
  ];
  for (const [name, change] of changes) {
    const settings = structuredClone(GENERATION_SETTINGS);
    change(settings);
    assert.notEqual(await deriveSearchCacheVersion(settings, emojis, 1), original, name);
  }
});

test("catalog and parser/filter revision changes invalidate cache identity", async () => {
  const original = await deriveSearchCacheVersion(GENERATION_SETTINGS, ["🐶", "🐱"], 1);
  for (const emojis of [["🐶"], ["🐶", "🐱", "🐻"], ["🐶", "🐻"]]) {
    assert.notEqual(await deriveSearchCacheVersion(GENERATION_SETTINGS, emojis, 1), original);
  }
  assert.notEqual(await deriveSearchCacheVersion(GENERATION_SETTINGS, ["🐶", "🐱"], 2), original);
});

test("unchanged inputs have stable identity and active key uses current settings and catalog", async () => {
  const expected = await deriveSearchCacheVersion(GENERATION_SETTINGS, Object.keys(emojilib), 1);
  assert.match(expected, /^[a-f0-9]{64}$/);
  assert.equal(await deriveSearchCacheVersion(structuredClone(GENERATION_SETTINGS), Object.keys(emojilib), 1), expected);
  assert.equal(await getSearchCacheVersion(), expected);
});
