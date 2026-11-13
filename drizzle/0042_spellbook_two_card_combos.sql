CREATE TABLE "spellbook_two_card_combos" (
	"id" text PRIMARY KEY NOT NULL,
	"oracle_id_a" text NOT NULL,
	"oracle_id_b" text NOT NULL,
	"card_name_a" text NOT NULL,
	"card_name_b" text NOT NULL,
	"produces" jsonb NOT NULL,
	"bracket_tag" text,
	"mana_value" integer,
	"forces_bracket" integer NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "spellbook_forces_bracket_range" CHECK ("spellbook_two_card_combos"."forces_bracket" in (3, 4))
);
--> statement-breakpoint
CREATE INDEX "spellbook_combos_a_idx" ON "spellbook_two_card_combos" USING btree ("oracle_id_a");--> statement-breakpoint
CREATE INDEX "spellbook_combos_b_idx" ON "spellbook_two_card_combos" USING btree ("oracle_id_b");