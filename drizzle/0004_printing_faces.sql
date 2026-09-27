ALTER TABLE "printings" ADD COLUMN "faces" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "printings" ADD COLUMN "artist" text;