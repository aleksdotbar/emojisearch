import fs from "node:fs/promises"
import emojilib from "emojilib" with { type: 'json' }
import { embedMany } from "ai"

const { embeddings } = await embedMany({
  model: "openai/text-embedding-3-small",
  values: Object.entries(emojilib).map(([emoji, keywords]) => `${emoji}: ${keywords.join(" ")}`),
});

await fs.writeFile("embeddings.json", JSON.stringify(embeddings, null, 2));
