CREATE TABLE "artwork_files" (
	"image_id" text PRIMARY KEY NOT NULL,
	"downloaded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_wpn_links" (
	"product_id" text PRIMARY KEY NOT NULL,
	"wpn_set_code" text,
	"wpn_name" text,
	"match" text NOT NULL,
	"photo" text NOT NULL,
	"photo_index" integer,
	CONSTRAINT "product_wpn_links_match_known" CHECK ("product_wpn_links"."match" in ('by_name', 'by_kind', 'admin')),
	CONSTRAINT "product_wpn_links_photo_known" CHECK ("product_wpn_links"."photo" in ('variants', 'one', 'none')),
	CONSTRAINT "product_wpn_links_one_has_index" CHECK (("product_wpn_links"."photo" = 'one') = ("product_wpn_links"."photo_index" is not null))
);
--> statement-breakpoint
CREATE TABLE "wpn_pages" (
	"set_code" text PRIMARY KEY NOT NULL,
	"slug_override" text,
	"slug" text,
	"status" text NOT NULL,
	"key_art" jsonb,
	"error" text,
	"checked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wpn_pages_status_known" CHECK ("wpn_pages"."status" in ('found', 'no_page', 'unreadable'))
);
--> statement-breakpoint
CREATE TABLE "wpn_products" (
	"set_code" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"release_date" text,
	"msrp_cents" integer,
	"description" text,
	"contents" jsonb NOT NULL,
	"images" jsonb NOT NULL,
	CONSTRAINT "wpn_products_set_code_name_pk" PRIMARY KEY("set_code","name"),
	CONSTRAINT "wpn_products_msrp_range" CHECK ("wpn_products"."msrp_cents" between 1 and 1000000)
);
--> statement-breakpoint
ALTER TABLE "product_wpn_links" ADD CONSTRAINT "product_wpn_links_product_id_sealed_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."sealed_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wpn_pages" ADD CONSTRAINT "wpn_pages_set_code_card_sets_code_fk" FOREIGN KEY ("set_code") REFERENCES "public"."card_sets"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wpn_products" ADD CONSTRAINT "wpn_products_set_code_card_sets_code_fk" FOREIGN KEY ("set_code") REFERENCES "public"."card_sets"("code") ON DELETE no action ON UPDATE no action;