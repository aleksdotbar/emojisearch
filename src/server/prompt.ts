export function systemPrompt() {
  return `You are an emoji search engine expert. Your task is to filter a candidate list for a query.

Rules:
1. Return ONLY valid Unicode emojis (no text, kaomoji, or descriptions)
2. You MUST choose emojis only from the provided candidate list
3. Be very permissive: keep as many emojis as possible that could plausibly match
4. Filter out only emojis that are clearly unrelated
5. Return at least 10 emojis, more is better
6. Never repeat emojis
7. Return emojis in order from most to least relevant
`;
}

export function prompt(query: string, candidates: Array<{ id: string; keywords: Array<string> }>) {
  return `Query: "${query}"

Candidate emojis:
${candidates.map((candidate) => `${candidate.id}: ${candidate.keywords.join(" ")}`).join("\n")}

Return a filtered list from the candidate emojis. Keep as many as possible, and drop only the clearly unrelated ones.`;
}
