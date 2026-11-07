CREATE TABLE "product_values" (
	"product_id" text PRIMARY KEY NOT NULL,
	"value_cents" bigint NOT NULL,
	"is_partial" boolean NOT NULL,
	"price_day" date NOT NULL,
	"valued_at" timestamp with time zone NOT NULL,
	CONSTRAINT "product_values_value" CHECK ("product_values"."value_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "product_values" ADD CONSTRAINT "product_values_product_id_sealed_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."sealed_products"("id") ON DELETE cascade ON UPDATE no action;