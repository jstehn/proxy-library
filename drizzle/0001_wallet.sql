CREATE TABLE "economy_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"allowance_cents" bigint NOT NULL,
	"allowance_period_days" integer NOT NULL,
	"allowance_anchor" timestamp with time zone NOT NULL,
	"starting_grant_cents" bigint NOT NULL,
	"self_fund_limit_cents" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text,
	CONSTRAINT "economy_settings_single_row" CHECK ("economy_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"created_by" text,
	"effective_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_amount_nonzero" CHECK ("ledger_entries"."amount_cents" <> 0),
	CONSTRAINT "ledger_entries_kind_known" CHECK ("ledger_entries"."kind" in ('starting_grant', 'allowance', 'grant', 'correction', 'self_fund')),
	CONSTRAINT "ledger_entries_direction" CHECK (("ledger_entries"."kind" = 'correction') = ("ledger_entries"."amount_cents" < 0))
);
--> statement-breakpoint
CREATE TABLE "wallet_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"allowance_paid_through" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_wallet_accounts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."wallet_accounts"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_players_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_user_id_players_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_user_effective_idx" ON "ledger_entries" USING btree ("user_id","effective_at" DESC NULLS LAST);