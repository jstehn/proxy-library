CREATE TABLE "draft_basics" (
	"draft_id" bigint NOT NULL,
	"position" integer NOT NULL,
	"user_id" text NOT NULL,
	"printing_id" text NOT NULL,
	"finish" text NOT NULL,
	CONSTRAINT "draft_basics_draft_id_position_pk" PRIMARY KEY("draft_id","position")
);
--> statement-breakpoint
DROP INDEX "draft_seats_one_active_idx";--> statement-breakpoint
ALTER TABLE "draft_seats" DROP CONSTRAINT "draft_seats_draft_id_user_id_pk";--> statement-breakpoint
ALTER TABLE "draft_seats" ADD COLUMN "bot_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_seats" ADD CONSTRAINT "draft_seats_draft_id_user_id_bot_number_pk" PRIMARY KEY("draft_id","user_id","bot_number");--> statement-breakpoint
ALTER TABLE "draft_basics" ADD CONSTRAINT "draft_basics_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_basics" ADD CONSTRAINT "draft_basics_user_id_players_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_basics" ADD CONSTRAINT "draft_basics_printing_id_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_seats_one_active_idx" ON "draft_seats" USING btree ("user_id") WHERE "draft_seats"."is_active" and "draft_seats"."bot_number" = 0;--> statement-breakpoint
ALTER TABLE "draft_seats" ADD CONSTRAINT "draft_seats_bot_number" CHECK ("draft_seats"."bot_number" >= 0);