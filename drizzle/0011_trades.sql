CREATE TABLE "trade_items" (
	"trade_id" bigint NOT NULL,
	"position" integer NOT NULL,
	"from_side" text NOT NULL,
	"kind" text NOT NULL,
	"printing_id" text,
	"finish" text,
	"quantity" integer,
	"amount_cents" bigint,
	CONSTRAINT "trade_items_trade_id_position_pk" PRIMARY KEY("trade_id","position"),
	CONSTRAINT "trade_items_side_known" CHECK ("trade_items"."from_side" in ('proposer', 'recipient')),
	CONSTRAINT "trade_items_shape" CHECK (("trade_items"."kind" = 'card' and "trade_items"."printing_id" is not null and "trade_items"."finish" is not null
            and "trade_items"."quantity" between 1 and 99 and "trade_items"."amount_cents" is null)
       or ("trade_items"."kind" = 'money' and "trade_items"."amount_cents" between 1 and 1000000
            and "trade_items"."printing_id" is null and "trade_items"."quantity" is null))
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"proposer_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"status" text NOT NULL,
	"message" text NOT NULL,
	"replaces_id" bigint,
	"created_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "trades_status_known" CHECK ("trades"."status" in ('proposed', 'accepted', 'declined', 'cancelled', 'countered')),
	CONSTRAINT "trades_not_with_yourself" CHECK ("trades"."proposer_id" <> "trades"."recipient_id"),
	CONSTRAINT "trades_decided_at" CHECK (("trades"."status" = 'proposed') = ("trades"."decided_at" is null))
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_kind_known";--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_direction";--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_printing_id_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_proposer_id_players_user_id_fk" FOREIGN KEY ("proposer_id") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_recipient_id_players_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_replaces_id_trades_id_fk" FOREIGN KEY ("replaces_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trades_proposer_idx" ON "trades" USING btree ("proposer_id","status");--> statement-breakpoint
CREATE INDEX "trades_recipient_idx" ON "trades" USING btree ("recipient_id","status");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_kind_known" CHECK ("ledger_entries"."kind" in ('starting_grant', 'allowance', 'grant', 'correction', 'self_fund', 'purchase_sealed', 'purchase_single', 'sellback', 'trade_in', 'trade_out'));--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_direction" CHECK (("ledger_entries"."kind" in ('correction', 'purchase_sealed', 'purchase_single', 'trade_out')) = ("ledger_entries"."amount_cents" < 0));