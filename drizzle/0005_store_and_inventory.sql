CREATE TABLE "acquisitions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"printing_id" text NOT NULL,
	"finish" text NOT NULL,
	"quantity" integer NOT NULL,
	"source" text NOT NULL,
	"ref" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "acquisitions_quantity_nonzero" CHECK ("acquisitions"."quantity" <> 0),
	CONSTRAINT "acquisitions_source_known" CHECK ("acquisitions"."source" in ('pack', 'deck', 'product', 'store', 'sale', 'trade'))
);
--> statement-breakpoint
CREATE TABLE "collection_cards" (
	"user_id" text NOT NULL,
	"printing_id" text NOT NULL,
	"finish" text NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "collection_cards_user_id_printing_id_finish_pk" PRIMARY KEY("user_id","printing_id","finish"),
	CONSTRAINT "collection_cards_quantity_positive" CHECK ("collection_cards"."quantity" > 0),
	CONSTRAINT "collection_cards_finish_known" CHECK ("collection_cards"."finish" in ('nonfoil', 'foil', 'etched'))
);
--> statement-breakpoint
CREATE TABLE "item_openings" (
	"item_id" bigint PRIMARY KEY NOT NULL,
	"seed" text,
	"result" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sealed_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"content_kind" text NOT NULL,
	"product_id" text,
	"set_code" text,
	"booster_type" text,
	"deck_name" text,
	"name" text NOT NULL,
	"parent_id" bigint,
	"status" text NOT NULL,
	"origin" text NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone,
	CONSTRAINT "sealed_items_status_known" CHECK ("sealed_items"."status" in ('unopened', 'opened')),
	CONSTRAINT "sealed_items_origin_known" CHECK ("sealed_items"."origin" in ('purchase', 'unpacked')),
	CONSTRAINT "sealed_items_content_shape" CHECK (("sealed_items"."content_kind" = 'product' and "sealed_items"."product_id" is not null)
       or ("sealed_items"."content_kind" = 'pack' and "sealed_items"."set_code" is not null and "sealed_items"."booster_type" is not null)
       or ("sealed_items"."content_kind" = 'deck' and "sealed_items"."set_code" is not null and "sealed_items"."deck_name" is not null)),
	CONSTRAINT "sealed_items_opened_at" CHECK (("sealed_items"."status" = 'opened') = ("sealed_items"."opened_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "msrp_overrides" (
	"product_id" text PRIMARY KEY NOT NULL,
	"cents" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text,
	CONSTRAINT "msrp_overrides_range" CHECK ("msrp_overrides"."cents" between 1 and 1000000)
);
--> statement-breakpoint
CREATE TABLE "msrp_prices" (
	"kind" text PRIMARY KEY NOT NULL,
	"cents" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text,
	CONSTRAINT "msrp_prices_range" CHECK ("msrp_prices"."cents" between 1 and 1000000)
);
--> statement-breakpoint
CREATE TABLE "store_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"item_kind" text NOT NULL,
	"direction" text NOT NULL,
	"product_id" text,
	"printing_id" text,
	"finish" text,
	"quantity" integer NOT NULL,
	"unit_market_cents" bigint NOT NULL,
	"rate_bps" integer NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"price_day" date,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "store_transactions_quantity_positive" CHECK ("store_transactions"."quantity" > 0),
	CONSTRAINT "store_transactions_direction_known" CHECK ("store_transactions"."direction" in ('buy', 'sell')),
	CONSTRAINT "store_transactions_item_shape" CHECK (("store_transactions"."item_kind" = 'sealed' and "store_transactions"."product_id" is not null and "store_transactions"."direction" = 'buy')
       or ("store_transactions"."item_kind" = 'single' and "store_transactions"."printing_id" is not null and "store_transactions"."finish" is not null)),
	CONSTRAINT "store_transactions_total" CHECK ("store_transactions"."total_cents" = "store_transactions"."unit_price_cents" * "store_transactions"."quantity"),
	CONSTRAINT "store_transactions_rate" CHECK ("store_transactions"."rate_bps" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_kind_known";--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_direction";--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "ref" text;--> statement-breakpoint
ALTER TABLE "acquisitions" ADD CONSTRAINT "acquisitions_user_id_players_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisitions" ADD CONSTRAINT "acquisitions_printing_id_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_cards" ADD CONSTRAINT "collection_cards_user_id_players_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_cards" ADD CONSTRAINT "collection_cards_printing_id_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_openings" ADD CONSTRAINT "item_openings_item_id_sealed_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."sealed_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sealed_items" ADD CONSTRAINT "sealed_items_owner_id_players_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sealed_items" ADD CONSTRAINT "sealed_items_parent_id_sealed_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."sealed_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "msrp_overrides" ADD CONSTRAINT "msrp_overrides_product_id_sealed_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."sealed_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_transactions" ADD CONSTRAINT "store_transactions_user_id_players_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_transactions" ADD CONSTRAINT "store_transactions_product_id_sealed_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."sealed_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_transactions" ADD CONSTRAINT "store_transactions_printing_id_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acquisitions_user_created_idx" ON "acquisitions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sealed_items_owner_status_idx" ON "sealed_items" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "sealed_items_parent_idx" ON "sealed_items" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "store_transactions_user_created_idx" ON "store_transactions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "store_transactions_printing_idx" ON "store_transactions" USING btree ("printing_id");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_kind_known" CHECK ("ledger_entries"."kind" in ('starting_grant', 'allowance', 'grant', 'correction', 'self_fund', 'purchase_sealed', 'purchase_single', 'sellback'));--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_direction" CHECK (("ledger_entries"."kind" in ('correction', 'purchase_sealed', 'purchase_single')) = ("ledger_entries"."amount_cents" < 0));