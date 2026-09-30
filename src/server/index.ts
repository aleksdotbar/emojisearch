import { zValidator } from "@hono/zod-validator";
import { createGateway, embed } from "ai";
import { env } from "cloudflare:workers";
import emojilib from "emojilib";
import { Hono } from "hono";
import * as z from "zod";
import {
  EMBEDDING_CACHE_KEY,
  QUERY_EMBEDDING_MODEL,
  embeddingProviderOptions,
  embeddingSchema,
} from "./embeddings";
import { RERANK_CACHE_KEY, dedupeEmojis, rerankEmojis } from "./rerank";
import type { MatchedEmoji } from "./rerank";

const app = new Hono<{ Bindings: Env }>()
  .basePath("/api")

  .get(
    "/emojis/search",
    zValidator(
      "query",
      z.object({
        query: z.string().min(1).max(80),
      }),
      (result, c) => {
        if (!result.success) {
          for (const issue of result.error.issues) {
            if (issue.code === "too_big") {
              return c.json(
                { ok: false as const, error: { code: "QUERY_TOO_LONG" as const } },
                400
              );
            }
          }

          return c.json({ ok: false as const, error: { code: "INVALID_QUERY" as const } }, 400);
        }
      }
    ),
    async (c) => {
      const { query } = c.req.valid("query");

      const { success } = await c.env.RATE_LIMITER.limit({ key: getRateLimitKey(c) });
      if (!success) {
        return c.json({ ok: false, error: { code: "RATE_LIMIT_EXCEEDED" as const } }, 429);
      }

      const emojis = await searchEmojis(c.env, query);

      return c.json({ ok: true, emojis });
    }
  );

const MATCH_TOP_K = 100;
const SEARCH_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;

const gateway = createGateway({ apiKey: env.AI_GATEWAY_API_KEY });

async function searchEmojis(env: Env, query: string): Promise<Array<string>> {
  const normalizedQuery = normalizeQuery(query);
  const searchCacheKey = `search:${RERANK_CACHE_KEY}:${EMBEDDING_CACHE_KEY}:${MATCH_TOP_K}:${normalizedQuery}`;

  const cachedSearch = await env.EMOJI_CACHE.get<Array<string>>(searchCacheKey, "json");
  if (cachedSearch !== null) {
    return cachedSearch;
  }

  const candidates = await getMatches(env, normalizedQuery);

  let emojis: Array<string>;
  try {
    emojis = await rerankEmojis(env.TYPESAFE_API_KEY, normalizedQuery, candidates);
  } catch (error) {
    console.error("Emoji reranking failed; returning vector matches.", {
      error: error instanceof Error ? error.message : String(error),
    });

    return dedupeEmojis(candidates.map((candidate) => candidate.id));
  }

  await env.EMOJI_CACHE.put(searchCacheKey, JSON.stringify(emojis), {
    expirationTtl: SEARCH_CACHE_TTL_SECONDS,
  });

  return emojis;
}

export default app;

export type AppType = typeof app;

async function getMatches(env: Env, normalizedQuery: string): Promise<Array<MatchedEmoji>> {
  const matchesCacheKey = `matches:${EMBEDDING_CACHE_KEY}:${MATCH_TOP_K}:${normalizedQuery}`;
  const cachedMatches = await env.EMOJI_CACHE.get<Array<MatchedEmoji>>(matchesCacheKey, "json");

  if (cachedMatches?.length) {
    return cachedMatches;
  }

  const { embedding } = await embed({
    model: gateway.embeddingModel(QUERY_EMBEDDING_MODEL),
    value: normalizedQuery,
    providerOptions: embeddingProviderOptions("query"),
    abortSignal: AbortSignal.timeout(10_000),
  });

  const result = await env.VECTORIZE.query(embeddingSchema.parse(embedding), {
    topK: MATCH_TOP_K,
  });

  const matchedEmojis = result.matches.map((match) => ({
    id: match.id,
    keywords: emojilib[match.id] ?? [],
  }));

  await env.EMOJI_CACHE.put(matchesCacheKey, JSON.stringify(matchedEmojis));

  return matchedEmojis;
}

function normalizeQuery(query: string) {
  return query.trim().toLowerCase();
}

function getRateLimitKey(c: { req: { header: (name: string) => string | undefined } }) {
  const forwarded = c.req.header("x-forwarded-for");
  const ip =
    c.req.header("cf-connecting-ip") ??
    (forwarded ? forwarded.split(",")[0]?.trim() : undefined) ??
    "unknown";

  return `search:${ip}`;
}
