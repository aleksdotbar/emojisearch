import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dedupeEmojis,
  rankedEmojis,
  relevanceQuestions,
  rerankEmojis,
} from "../src/server/rerank.ts";

const candidates = [
  { id: "🍕", keywords: ["pizza", "food"] },
  { id: "🎉", keywords: ["party", "celebration"] },
  { id: "🧀", keywords: ["cheese", "food"] },
  { id: "🚀", keywords: ["rocket", "space"] },
];

function answers(scores) {
  return Object.fromEntries(
    scores.map((score, index) => [`candidate_${index}`, { type: "score", score }]),
  );
}

test("relevance scores determine order and equal scores retain vector order", () => {
  assert.deepEqual(rankedEmojis(candidates, answers([2, 3, 2, 1])), ["🎉", "🍕", "🧀"]);
});

test("weak associations are excluded without padding results", () => {
  const cases = [
    { scores: [3, 1, 1.49, 0], expected: ["🍕"] },
    { scores: [1.5, 1.49, 1, 0], expected: ["🍕"] },
    { scores: [1, 0, 0.9, 1.49], expected: [] },
  ];

  for (const { scores, expected } of cases) {
    assert.deepEqual(rankedEmojis(candidates, answers(scores)), expected, `scores: ${scores}`);
  }
});

test("malformed or incomplete scores must fail instead of silently dropping candidates", () => {
  const valid = answers([3, 2, 1, 0]);
  const cases = [
    { name: "missing answer", value: answers([3, 2, 1]) },
    { name: "unknown answer", value: { ...valid, unexpected: { type: "score", score: 3 } } },
    { name: "wrong identity", value: { ...answers([3, 2, 1]), other: valid.candidate_3 } },
    { name: "wrong type", value: { ...valid, candidate_0: { type: "noul", score: 3 } } },
    { name: "string score", value: answers(["3", 2, 1, 0]) },
    { name: "NaN score", value: answers([NaN, 2, 1, 0]) },
    { name: "infinite score", value: answers([Infinity, 2, 1, 0]) },
    { name: "negative score", value: answers([-0.1, 2, 1, 0]) },
    { name: "score outside rubric", value: answers([3.1, 2, 1, 0]) },
  ];

  for (const { name, value } of cases) {
    assert.throws(() => rankedEmojis(candidates, value), undefined, `should reject: ${name}`);
  }
});

test("output contains only valid unique candidate emojis", () => {
  const repeated = [
    { id: "❤", keywords: ["heart"] },
    { id: "❤️", keywords: ["heart"] },
    { id: "not an emoji", keywords: [] },
  ];

  assert.deepEqual(rankedEmojis(repeated, answers([2, 3, 3])), ["❤️"]);
  assert.deepEqual(dedupeEmojis(repeated.map(({ id }) => id)), ["❤"]);
});

test("each candidate receives its own question and four ordered relevance levels", () => {
  const questions = relevanceQuestions(candidates);
  assert.equal(Object.keys(questions).length, candidates.length);

  for (const [index, candidate] of candidates.entries()) {
    const question = questions[`candidate_${index}`];
    assert.equal(question.type, "score");
    assert.equal(question.instructions.emoji, candidate.id);
    assert.deepEqual(question.instructions.keywords, candidate.keywords);
    assert.equal(question.criteria.length, 4);
  }
});

test("SDK sends one direct TypeSafe request and rejects unusable answers", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let reply = answers([3, 0, 2, 0]);

  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(String(url), "https://api.typesafe.ai/v1/systemone");
    assert.equal(new Headers(options.headers).get("Authorization"), "Bearer test-key");
    assert.ok(options.signal instanceof AbortSignal);

    const body = JSON.parse(options.body);
    assert.equal(body.model, "jev-latest");
    assert.deepEqual(body.state, { query: "pizza" });
    assert.deepEqual(body.questions, relevanceQuestions(candidates));

    return Response.json({ model: "jev-latest", answers: reply, usage: {} });
  };

  try {
    assert.deepEqual(await rerankEmojis("test-key", "pizza", candidates), ["🍕", "🧀"]);
    assert.equal(calls, 1);

    reply = answers([3]);
    await assert.rejects(rerankEmojis("test-key", "pizza", candidates));
    assert.equal(calls, 2);

    reply = answers([0, 0, 0, 0]);
    assert.deepEqual(await rerankEmojis("test-key", "pizza", candidates), []);
    assert.equal(calls, 3);

    assert.deepEqual(await rerankEmojis("test-key", "pizza", []), []);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
