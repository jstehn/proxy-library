CREATE TABLE "wishes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"oracle_id" text NOT NULL,
	"printing_id" text,
	"finish" text NOT NULL,
	"quantity" smallint NOT NULL,
	"target_cents" bigint,
	"saved_cents" bigint,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wishes_quantity" CHECK ("wishes"."quantity" between 1 and 99),
	CONSTRAINT "wishes_target" CHECK ("wishes"."target_cents" between 1 and 10000000),
	CONSTRAINT "wishes_note" CHECK (length("wishes"."note") <= 200),
	CONSTRAINT "wishes_finish" CHECK (("wishes"."printing_id" is null and "wishes"."finish" in ('nonfoil', 'foil', 'cheapest'))
        or ("wishes"."printing_id" is not null and "wishes"."finish" in ('nonfoil', 'foil', 'etched')))
);
--> statement-breakpoint
ALTER TABLE "wishes" ADD CONSTRAINT "wishes_user_id_players_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishes" ADD CONSTRAINT "wishes_printing_id_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wishes_any_printing_idx" ON "wishes" USING btree ("user_id","oracle_id","finish") WHERE "wishes"."printing_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "wishes_exact_printing_idx" ON "wishes" USING btree ("user_id","printing_id","finish") WHERE "wishes"."printing_id" is not null;--> statement-breakpoint
CREATE INDEX "wishes_user_idx" ON "wishes" USING btree ("user_id","created_at");