CREATE TABLE "comprehensive_rules" (
	"rule_number" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"section" text NOT NULL,
	"parent_number" text,
	"title" text,
	"text" text NOT NULL,
	"cr_version" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "comprehensive_rules_hnsw_idx" ON "comprehensive_rules" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "comprehensive_rules_parent_idx" ON "comprehensive_rules" USING btree ("parent_number");
--> statement-breakpoint
CREATE INDEX "comprehensive_rules_fts_idx" ON "comprehensive_rules" USING gin (to_tsvector('english', coalesce("title", '') || ' ' || "text"));
