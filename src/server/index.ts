import type { GatewayProviderOptions } from "@ai-sdk/gateway";
import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { zValidator } from "@hono/zod-validator";
import { createGateway, embed, generateText, Output } from "ai";
import { env } from "cloudflare:workers";
import emojilib from "emojilib";
import { Hono } from "hono";
import * as z from "zod";
import { prompt, systemPrompt } from "./prompt";

const app = new Hono<{ Bindings: Env }>()
  .basePath("/api")

  .get(
    "/emojis/search",
    zValidator(
      "query",
      z.object({
        query: z.string().min(1),
      })
    ),
    async (c) => {
      const { query } = c.req.valid("query");

      const { success } = await c.env.RATE_LIMITER.limit({ key: getRateLimitKey(c) });
      if (!success) {
        return c.json({ error: "Rate limit exceeded" }, 429);
      }

      const emojis = await searchEmojis(c.env, query);

      return c.json({ emojis });
    }
  );

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const MATCH_TOP_K = 100;
const RERANK_MODEL = "openai/gpt-oss-120b";
const SEARCH_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;
const MIN_EMOJIS_TO_CACHE = 10;

const gateway = createGateway({ apiKey: env.AI_GATEWAY_API_KEY });

async function searchEmojis(env: Env, query: string): Promise<Array<string>> {
  const normalizedQuery = normalizeQuery(query);
  const searchCacheKey = `search:${RERANK_MODEL}:${normalizedQuery}`;

  const cachedSearch = await env.EMOJI_CACHE.get<Array<string>>(searchCacheKey, "json");
  if (cachedSearch?.length) {
    return cachedSearch;
  }

  const candidates = await getMatches(env, normalizedQuery);

  const { output } = await generateText({
    model: gateway(RERANK_MODEL),
    system: systemPrompt(),
    prompt: prompt(normalizedQuery, candidates),
    timeout: 10_000,
    temperature: 0.1,
    providerOptions: {
      gateway: {
        order: ["cerebras"],
      } satisfies GatewayProviderOptions,
      openai: {
        reasoningEffort: "low",
      } satisfies OpenAIResponsesProviderOptions,
    },
    output: Output.object({
      schema: z.object({
        emojis: z.array(z.string()),
      }),
    }),
  });

  const emojis = dedupeEmojis(output.emojis);

  if (emojis.length >= MIN_EMOJIS_TO_CACHE) {
    await env.EMOJI_CACHE.put(searchCacheKey, JSON.stringify(emojis), {
      expirationTtl: SEARCH_CACHE_TTL_SECONDS,
    });
  }

  return emojis;
}

export default app;

export type AppType = typeof app;

type MatchedEmoji = {
  id: string;
  keywords: string[];
};

async function getMatches(env: Env, normalizedQuery: string): Promise<Array<MatchedEmoji>> {
  const matchesCacheKey = `matches:${EMBEDDING_MODEL}:${MATCH_TOP_K}:${normalizedQuery}`;
  const cachedMatches = await env.EMOJI_CACHE.get<Array<MatchedEmoji>>(matchesCacheKey, "json");

  if (cachedMatches?.length) {
    return cachedMatches;
  }

  const { embedding } = await embed({
    model: gateway.embeddingModel(EMBEDDING_MODEL),
    value: normalizedQuery,
  });

  const result = await env.VECTORIZE.query(embedding, { topK: MATCH_TOP_K });

  const matchedEmojis = result.matches.map((match) => ({
    id: match.id,
    keywords: emojilib[match.id] ?? [],
  }));

  await env.EMOJI_CACHE.put(matchesCacheKey, JSON.stringify(matchedEmojis));

  return matchedEmojis;
}

function dedupeEmojis(emojis: string[]) {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const emoji of emojis) {
    if (!isValidEmoji(emoji)) {
      continue;
    }

    const key = normalizeEmoji(emoji);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(emoji);
  }

  return unique;
}

function isValidEmoji(emoji: string) {
  return z.emoji().safeParse(emoji).success;
}

function normalizeEmoji(emoji: string) {
  return emoji.replace(/[\uFE0E\uFE0F]/g, "");
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
