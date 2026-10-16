import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import * as z from "zod";
import { GenerationError, generateEmojis, getSearchCacheVersion } from "./generate.ts";

const app = new Hono<{ Bindings: Env }>()
  .basePath("/api")

  .get(
    "/emojis/search",
    zValidator(
      "query",
      z.object({
        query: z.string().max(80).trim().min(1),
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

      try {
        const emojis = await searchEmojis(c.env, query, c.req.raw.signal);
        return c.json({ ok: true as const, emojis });
      } catch (error) {
        console.error("Emoji search failed.", error instanceof GenerationError
          ? { kind: error.kind, status: error.status }
          : { kind: "cache_or_configuration" });
        return c.json({ ok: false as const, error: { code: "SEARCH_UNAVAILABLE" as const } }, 503);
      }
    }
  );

const SEARCH_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;

async function searchEmojis(env: Env, query: string, signal: AbortSignal): Promise<Array<string>> {
  const normalizedQuery = normalizeQuery(query);
  const searchCacheKey = `search:${await getSearchCacheVersion()}:${normalizedQuery}`;

  const cachedSearch = await env.EMOJI_CACHE.get<Array<string>>(searchCacheKey, "json");
  if (cachedSearch !== null) {
    return cachedSearch;
  }

  const emojis = await generateEmojis({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    gatewayId: env.CLOUDFLARE_AI_GATEWAY_ID,
    token: env.CLOUDFLARE_AI_GATEWAY_TOKEN,
  }, normalizedQuery, signal);

  await env.EMOJI_CACHE.put(searchCacheKey, JSON.stringify(emojis), {
    expirationTtl: SEARCH_CACHE_TTL_SECONDS,
  });

  return emojis;
}

export default app;

export type AppType = typeof app;

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
