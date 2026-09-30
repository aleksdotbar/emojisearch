# 🔎 AI-powered emoji search

Emoji search using Voyage vector retrieval and Jev relevance scoring.

## 🛠️ Tech stack

- ☁️ Hono + Cloudflare Workers (API)
- 🧬 Vectorize (vector search)
- 📦 Cloudflare KV (cache) + Rate Limiter
- 🤖 Jev for re-ranking, billed directly by TypeSafe
- ⚡️ React + Vite
- 🎨 shadcn/ui + Tailwind

## Rebuild emoji vectors

Use Node.js 22.18 or later. Set `AI_GATEWAY_API_KEY` in your shell or an ignored
`.env` file, and authenticate Wrangler with `pnpm exec wrangler login` or
`CLOUDFLARE_API_TOKEN`.

Documents use `voyage/voyage-4`; queries use `voyage/voyage-4-lite`. Both use
1,024-dimensional float vectors, with `document` and `query` input types respectively.

```sh
node --env-file-if-exists=.env scripts/embed.mjs
pnpm exec wrangler vectorize create emojisearch-voyage-4 --dimensions=1024 --metric=cosine
pnpm exec wrangler vectorize upsert emojisearch-voyage-4 --file=vectors-voyage-4.ndjson
pnpm exec wrangler vectorize info emojisearch-voyage-4
```

The embedding script invalidates previous output and validates all vectors before
publishing NDJSON with emoji IDs. A failed rebuild leaves no upload file.
Wait for Vectorize to process the upload and report all 1,906 vectors before
deploying the Worker with its new binding. Generated vectors stay out of Git.

Keep the old `emojisearch` index until the migration is verified. To roll back,
restore the previous Worker version, which uses that index and OpenAI embeddings.
Never point Voyage queries at the old index.

## Jev reranking

Set `TYPESAFE_API_KEY` in the ignored `.env` file for local development. Voyage
continues to use `AI_GATEWAY_API_KEY` through Vercel; Jev uses the official
`@typesafe-ai/sdk` directly against TypeSafe.

Before deploying, configure the Worker secret with `pnpm exec wrangler secret put
TYPESAFE_API_KEY`. Secret configuration and deployment are separate operations.

Jev scores the 100 retrieved candidates in one request using four relevance levels:
unrelated (0), weak association (1), useful contextual match (2), direct match (3).
Results with scores of at least 1.5 are returned, ordered by score; ties retain vector
order. Results can contain fewer than ten emojis, including none.

Successful results, including empty lists, are cached for seven days. If Jev fails,
times out, or returns incomplete or invalid scores, search returns the vector-ranked
candidates without caching that fallback as a completed rerank.
