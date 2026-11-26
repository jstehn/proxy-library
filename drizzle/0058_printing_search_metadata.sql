ALTER TABLE "printings" ADD COLUMN "flavor_text" text;--> statement-breakpoint
ALTER TABLE "printings" ADD COLUMN "watermark" text;--> statement-breakpoint
ALTER TABLE "printings" ADD COLUMN "is_reserved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "printings" ADD COLUMN "is_story_spotlight" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "printings" ADD COLUMN "is_booster" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "printings" ADD COLUMN "is_textless" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "printings" ADD COLUMN "security_stamp" text;--> statement-breakpoint
ALTER TABLE "printings" ADD COLUMN "illustration_id" text;