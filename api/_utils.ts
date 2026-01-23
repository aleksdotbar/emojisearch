import { kv } from "@vercel/kv";
import OpenAI from "openai";
import split from "lodash.split";
import emojiList from "emoji.json/emoji-compact.json";

const openai = new OpenAI({
  apiKey: process.env.NUXT_OPENAI_API_KEY,
});

export const generateEmojis = async (prompt: string) => {
  const { output_text } = await openai.responses.create({
    model: "gpt-5-nano",
    input: [
      {
        role: "developer",
        content: [
          {
            type: "input_text",
            text: `Generate up to 20 emojis relevant to the prompt: "${prompt}". Do not repeat emojis. Format result as a joined string.`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "text",
      },
    },
    reasoning: {
      effort: "minimal",
    },
  });

  const validEmojis = splitEmojis(output_text ?? "").filter(isValidEmoji);

  return uniq(validEmojis);
};

const key = (prompt: string) => `emojis:${prompt}`;

export const cacheEmojis = async (prompt: string, emojis: Array<string>) => {
  if (emojis.length) {
    await kv.rpush(key(prompt), ...emojis);
  }
};

export const getCachedEmojis = async (prompt: string) => {
  return await kv.lrange(key(prompt), 0, -1);
};

const uniq = <T>(arr: T[]) => Array.from(new Set(arr));

const splitEmojis = (text: string) => (text ? split(text.replace(/\s/g, ""), "") : []);

const isValidEmoji = (emoji: string) => emojiList.includes(emoji);
