DROP INDEX "price_snapshots_day_idx";--> statement-breakpoint
DROP INDEX "activity_events_occurred_idx";--> statement-breakpoint
DROP INDEX "price_snapshots_day_printing_idx";--> statement-breakpoint
DROP INDEX "draft_seats_deadline_idx";--> statement-breakpoint
DROP INDEX "draft_seats_prompt_deadline_idx";--> statement-breakpoint
DROP INDEX "sealed_items_parent_idx";--> statement-breakpoint
CREATE INDEX "price_snapshots_printing_finish_day_desc_idx" ON "price_snapshots" USING btree ("printing_id","finish","day" DESC NULLS LAST,"usd_cents");--> statement-breakpoint
CREATE INDEX "printings_lower_front_name_idx" ON "printings" USING btree (lower(split_part("name", ' // ', 1))) WHERE "printings"."name" like '% // %';--> statement-breakpoint
CREATE INDEX "drafts_dealing_deadline_idx" ON "drafts" USING btree ("deal_deadline") WHERE "drafts"."status" = 'dealing' and "drafts"."deal_deadline" is not null;--> statement-breakpoint
CREATE INDEX "store_transactions_user_printing_idx" ON "store_transactions" USING btree ("user_id","printing_id","created_at","id") WHERE "store_transactions"."printing_id" is not null;--> statement-breakpoint
CREATE INDEX "wishes_user_oracle_idx" ON "wishes" USING btree ("user_id","oracle_id");--> statement-breakpoint
CREATE INDEX "wishes_user_targeted_idx" ON "wishes" USING btree ("user_id") WHERE "wishes"."target_cents" is not null;--> statement-breakpoint
CREATE INDEX "activity_events_occurred_idx" ON "activity_events" USING btree ("occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "price_snapshots_day_printing_idx" ON "price_snapshots" USING btree ("day","printing_id","finish","usd_cents");--> statement-breakpoint
CREATE INDEX "draft_seats_deadline_idx" ON "draft_seats" USING btree ("deadline") WHERE "draft_seats"."deadline" is not null;--> statement-breakpoint
CREATE INDEX "draft_seats_prompt_deadline_idx" ON "draft_seats" USING btree ("prompt_deadline") WHERE "draft_seats"."prompt_deadline" is not null;--> statement-breakpoint
CREATE INDEX "sealed_items_parent_idx" ON "sealed_items" USING btree ("parent_id") WHERE "sealed_items"."parent_id" is not null;