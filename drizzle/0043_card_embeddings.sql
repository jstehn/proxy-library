CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "card_embeddings" (
	"oracle_id" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"text_version" integer NOT NULL,
	"embedding" vector(384) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "card_embeddings_hnsw_idx" ON "card_embeddings" USING hnsw ("embedding" vector_cosine_ops);
