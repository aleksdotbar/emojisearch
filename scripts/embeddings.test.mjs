import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import emojilib from "emojilib" with { type: "json" };

import { embeddingSchema } from "../src/server/embeddings.ts";

test("Voyage vectors must have 1024 finite coordinates", () => {
  const valid = Array.from({ length: 1024 }, () => 0.25);

  assert.deepEqual(embeddingSchema.parse(valid), valid);

  const cases = [
    { name: "OpenAI dimensions", value: Array.from({ length: 1536 }, () => 0.25) },
    { name: "truncated vector", value: valid.slice(1) },
    { name: "NaN coordinate", value: [NaN, ...valid.slice(1)] },
    { name: "infinite coordinate", value: [Infinity, ...valid.slice(1)] },
    { name: "string coordinate", value: ["0.25", ...valid.slice(1)] },
  ];

  for (const { name, value } of cases) {
    assert.equal(embeddingSchema.safeParse(value).success, false, `should reject: ${name}`);
  }
});

test("rebuild preserves emoji IDs across gateway batches", () => {
  const directory = mkdtempSync(join(tmpdir(), "emojisearch-embeddings-"));

  try {
    const result = runRebuild(directory, 1024, 0);
    assert.equal(result.status, 0, result.stderr);

    const vectors = readFileSync(join(directory, "vectors-voyage-4.ndjson"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    assert.deepEqual(vectors.map(({ id }) => id), Object.keys(emojilib));

    for (const [index, vector] of vectors.entries()) {
      assert.equal(vector.values.length, 1024, `dimensions for ${vector.id}`);
      assert.equal(vector.values[0], index + 1, `embedding for ${vector.id}`);
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("invalid gateway batches never produce an upload file", () => {
  const cases = [
    { name: "wrong dimensions", dimensions: 1536, countOffset: 0 },
    { name: "missing embedding", dimensions: 1024, countOffset: -1 },
  ];

  for (const { name, dimensions, countOffset } of cases) {
    const directory = mkdtempSync(join(tmpdir(), "emojisearch-embeddings-"));

    try {
      writeFileSync(join(directory, "vectors-voyage-4.ndjson"), '{"id":"stale"}\n');

      const result = runRebuild(directory, dimensions, countOffset);
      assert.notEqual(result.status, 0, `should reject: ${name}`);
      assert.equal(existsSync(join(directory, "vectors-voyage-4.ndjson")), false, name);
    } finally {
      rmSync(directory, { recursive: true });
    }
  }
});

function runRebuild(directory, dimensions, countOffset) {
  const fixture = join(directory, "gateway.mjs");
  writeFileSync(fixture, `
    import assert from "node:assert/strict";
    import timers from "node:timers/promises";
    import { syncBuiltinESMExports } from "node:module";
    let offset = 0;

    timers.setTimeout = async (delay) => {
      assert.equal(delay, 13_000);
    };
    syncBuiltinESMExports();

    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), "https://ai-gateway.vercel.sh/v3/ai/embedding-model");
      assert.equal(new Headers(options.headers).get("ai-model-id"), "voyage/voyage-4");

      const { values, providerOptions } = JSON.parse(options.body);
      assert.ok(values.length <= 128);
      assert.deepEqual(providerOptions.voyage, {
        inputType: "document", outputDimension: 1024, outputDtype: "float", truncation: false,
      });

      const embeddings = Array.from({ length: values.length + ${countOffset} }, (_, index) =>
        Array.from({ length: ${dimensions} }, () => offset + index + 1));
      offset += values.length;

      return Response.json({ embeddings, usage: { tokens: values.length } });
    };
  `);

  return spawnSync(process.execPath, [
    "--import", fixture, fileURLToPath(new URL("./embed.mjs", import.meta.url)),
  ], {
    cwd: directory,
    env: { ...process.env, AI_GATEWAY_API_KEY: "test-key" },
    encoding: "utf8",
    timeout: 10_000,
  });
}
