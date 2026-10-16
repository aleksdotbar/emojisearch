# Emoji search

Associative emoji search using Hono on Cloudflare Workers, React, Vite, and Tailwind.
Cache misses call Groq's `openai/gpt-oss-120b` through Cloudflare AI Gateway using
Unified Billing credits. No Groq API key, embeddings, Vectorize, or Jev are required.

## Local development

Use Node.js 22.18 or later and pnpm. Set `CLOUDFLARE_AI_GATEWAY_TOKEN` in an ignored
`.env` file; `.env.example` lists the required secret. The token needs Cloudflare's
AI Gateway Run permission. The account and gateway IDs are configured in
`wrangler.json`; this project uses the `default` gateway. That gateway needs
Unified Billing credits and must allow requests without provider credentials.

```sh
pnpm install
pnpm dev
pnpm test
pnpm build
```

`pnpm cf-typegen` regenerates Worker types using `.env.example`, so unrelated local
secrets do not become required bindings. Keep the example updated if secrets change.

## Search behavior

The exact prompt and request settings live in `src/server/generate.ts`. The prompt
asks for literal and playful associations, including culture, memes, history, food,
sports, metaphors, and fictional references. The query is sent as a separate user
message. Generation uses low reasoning effort, temperature 0.4, a 1,500-token limit,
and a strict JSON schema with at most 30 emoji strings. The catalog is not sent to
the model.

Responses must finish normally and contain valid JSON. Local validation preserves
model order, filters entries against emojilib, canonicalizes variation selectors,
and removes duplicates. Fewer than 30 results, including none, are valid. Generation
has a ten-second deadline, a 64 KiB response limit, and no automatic server retries.
Provider failures return `SEARCH_UNAVAILABLE` (HTTP 503) and are not cached.

Normalized queries use a versioned seven-day KV cache, including empty results.
Old vector and Jev cache entries are ignored. Bump `SEARCH_CACHE_VERSION` when the
model, prompt, settings, validation, or catalog changes. The existing per-IP rate
limit remains ten searches per minute. Gateway caching is bypassed so KV owns result
expiration.

On October 15, 2026, a serial benchmark of 22 uncached requests per model used this
prompt and filtering: Groq GPT-OSS 120B had a 927.5 ms median (597–1,914 ms), versus
Gemini 3.5 Flash Lite at 1,477 ms (1,080–3,541 ms). Both completed 22/22 requests.
These are small-sample provider measurements, not production concurrency or p95
guarantees. Playful associations can still be weak or subjective after filtering.

## Deployment and rollback

Local `.env` credentials are not deployed. Before a separately authorized deployment,
configure the Worker secret with `pnpm exec wrangler secret put CLOUDFLARE_AI_GATEWAY_TOKEN`.
`pnpm deploy` builds and deploys the Worker; building or generating types does not.

The migration removes vector bindings and rebuild scripts from the application.
Existing remote indexes, cached entries, and local generated vector files are
preserved. To roll back, restore the previous Worker version and its bindings and
secrets. Do not delete old indexes or provider credentials until rollback is no
longer needed.
