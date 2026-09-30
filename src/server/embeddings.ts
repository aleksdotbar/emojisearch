import * as z from "zod";

export const DOCUMENT_EMBEDDING_MODEL = "voyage/voyage-4";
export const QUERY_EMBEDDING_MODEL = "voyage/voyage-4-lite";
export const EMBEDDING_DIMENSIONS = 1024;
export const EMBEDDING_CACHE_KEY =
  `${DOCUMENT_EMBEDDING_MODEL}:${QUERY_EMBEDDING_MODEL}:${EMBEDDING_DIMENSIONS}:v1`;

export const embeddingSchema = z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS);

export function embeddingProviderOptions(inputType: "document" | "query") {
  return {
    voyage: {
      inputType,
      outputDimension: EMBEDDING_DIMENSIONS,
      outputDtype: "float",
      truncation: false,
    },
  };
}
