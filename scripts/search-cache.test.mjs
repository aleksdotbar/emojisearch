import assert from "node:assert/strict";
import { test } from "node:test";

import { GENERATION_SETTINGS, deriveSearchCacheVersion } from "../src/server/generate.ts";

test("cache identity includes generation settings, supported catalog, and validation revision", async () => {
  const original = await deriveSearchCacheVersion(GENERATION_SETTINGS, ["🐶"], 1);
  const changedModel = { ...GENERATION_SETTINGS, model: "another-model" };
  assert.notEqual(await deriveSearchCacheVersion(changedModel, ["🐶"], 1), original, "settings omitted");
  assert.notEqual(await deriveSearchCacheVersion(GENERATION_SETTINGS, ["🐶", "🐱"], 1), original, "catalog omitted");
  assert.notEqual(await deriveSearchCacheVersion(GENERATION_SETTINGS, ["🐶"], 2), original, "validation revision omitted");
});
