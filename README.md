# 🔎 AI-powered emoji search

Emoji search that uses a lightweight RAG flow (vector retrieval + LLM re-ranking) to find the most relevant emojis for any query.

## 🛠️ Tech stack

- ☁️ Hono + Cloudflare Workers (API)
- 🧬 Vectorize (vector search)
- 📦 Cloudflare KV (cache) + Rate Limiter
- 🤖 LLM for re-ranking
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
