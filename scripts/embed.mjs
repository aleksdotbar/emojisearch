import fs from "node:fs/promises";

import { createGateway, embedMany } from "ai";
import emojilib from "emojilib" with { type: "json" };
import * as z from "zod";

import {
  DOCUMENT_EMBEDDING_MODEL,
  embeddingProviderOptions,
  embeddingSchema,
} from "../src/server/embeddings.ts";

const BATCH_SIZE = 128;
const OUTPUT_PATH = "vectors-voyage-4.ndjson";
const TEMPORARY_PATH = `${OUTPUT_PATH}.tmp`;
const apiKey = process.env.AI_GATEWAY_API_KEY;

await fs.rm(OUTPUT_PATH, { force: true });

if (!apiKey) {
  throw new Error("Set AI_GATEWAY_API_KEY before rebuilding emoji vectors.");
}

const gateway = createGateway({ apiKey });
const candidates = Object.entries(emojilib);
const vectors = [];

for (let offset = 0; offset < candidates.length; offset += BATCH_SIZE) {
  const batch = candidates.slice(offset, offset + BATCH_SIZE);
  const { embeddings } = await embedMany({
    model: gateway.embeddingModel(DOCUMENT_EMBEDDING_MODEL),
    values: batch.map(([emoji, keywords]) => `${emoji}: ${keywords.join(" ")}`),
    providerOptions: embeddingProviderOptions("document"),
    maxParallelCalls: 1,
    maxRetries: 2,
    abortSignal: AbortSignal.timeout(30_000),
  });

  const values = z.array(embeddingSchema).length(batch.length).parse(embeddings);

  vectors.push(...batch.map(([id], index) => ({ id, values: values[index] })));
  console.log(`Embedded ${vectors.length}/${candidates.length} emojis.`);
}

const ndjson = vectors.map((vector) => JSON.stringify(vector)).join("\n") + "\n";

await fs.writeFile(TEMPORARY_PATH, ndjson);
await fs.rename(TEMPORARY_PATH, OUTPUT_PATH);
console.log(`Wrote ${vectors.length} vectors to ${OUTPUT_PATH}.`);
