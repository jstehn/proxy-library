CREATE TABLE "printing_tokens" (
	"printing_id" text NOT NULL,
	"token_id" text NOT NULL,
	CONSTRAINT "printing_tokens_printing_id_token_id_pk" PRIMARY KEY("printing_id","token_id")
);
--> statement-breakpoint
CREATE TABLE "token_printings" (
	"id" text PRIMARY KEY NOT NULL,
	"oracle_id" text NOT NULL,
	"name" text NOT NULL,
	"set_code" text NOT NULL,
	"collector_number" text NOT NULL,
	"layout" text NOT NULL,
	"colors" text[] NOT NULL,
	"faces" jsonb NOT NULL,
	"artist" text,
	"image_uris" jsonb,
	"released_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deck_token_choices" (
	"deck_id" bigint NOT NULL,
	"token_oracle_id" text NOT NULL,
	"token_id" text,
	"included" boolean DEFAULT true NOT NULL,
	CONSTRAINT "deck_token_choices_deck_id_token_oracle_id_pk" PRIMARY KEY("deck_id","token_oracle_id")
);
--> statement-breakpoint
ALTER TABLE "printing_tokens" ADD CONSTRAINT "printing_tokens_printing_id_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printing_tokens" ADD CONSTRAINT "printing_tokens_token_id_token_printings_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."token_printings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_token_choices" ADD CONSTRAINT "deck_token_choices_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_token_choices" ADD CONSTRAINT "deck_token_choices_token_id_token_printings_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."token_printings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "printing_tokens_token_idx" ON "printing_tokens" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "token_printings_oracle_idx" ON "token_printings" USING btree ("oracle_id");