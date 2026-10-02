CREATE TABLE "draft_reveals" (
	"draft_id" bigint NOT NULL,
	"position" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"audience" integer,
	"seat" integer NOT NULL,
	"kind" text NOT NULL,
	"cards" jsonb NOT NULL,
	"about" jsonb,
	CONSTRAINT "draft_reveals_draft_id_position_pk" PRIMARY KEY("draft_id","position")
);
--> statement-breakpoint
ALTER TABLE "drafts" DROP CONSTRAINT "drafts_status_known";--> statement-breakpoint
ALTER TABLE "draft_cards" ADD COLUMN "pick_round" integer;--> statement-breakpoint
ALTER TABLE "draft_cards" ADD COLUMN "picked_random" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_cards" ADD COLUMN "pick_state" text;--> statement-breakpoint
ALTER TABLE "draft_cards" ADD COLUMN "pool_seat" integer;--> statement-breakpoint
ALTER TABLE "draft_cards" ADD COLUMN "notes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_cards" ADD COLUMN "came_from" jsonb;--> statement-breakpoint
ALTER TABLE "draft_packs" ADD COLUMN "last_passed_by" integer;--> statement-breakpoint
ALTER TABLE "draft_packs" ADD COLUMN "added_by" integer;--> statement-breakpoint
ALTER TABLE "draft_packs" ADD COLUMN "watchers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_seats" ADD COLUMN "deadline_pick" integer;--> statement-breakpoint
ALTER TABLE "draft_seats" ADD COLUMN "prompt_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "draft_seats" ADD COLUMN "abilities" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "watches" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "deals" jsonb;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "deal_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "draft_reveals" ADD CONSTRAINT "draft_reveals_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draft_seats_prompt_deadline_idx" ON "draft_seats" USING btree ("prompt_deadline");--> statement-breakpoint
ALTER TABLE "draft_cards" ADD CONSTRAINT "draft_cards_pick_state_known" CHECK ("draft_cards"."pick_state" is null or "draft_cards"."pick_state" in ('faceDown', 'faceUp', 'removedFaceDown', 'removedFaceUp', 'returned'));--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_status_known" CHECK ("drafts"."status" in ('lobby', 'drafting', 'dealing', 'finished', 'cancelled'));--> statement-breakpoint
-- Picks made before Conspiracy drafts: face down, in their drafter's pool, in their pack's round.
UPDATE "draft_cards" c SET "pick_state" = 'faceDown', "pool_seat" = c."picked_by_seat", "pick_round" = p."round" FROM "draft_packs" p WHERE p."draft_id" = c."draft_id" AND p."pack_number" = c."pack_number" AND c."picked_by_seat" IS NOT NULL;
