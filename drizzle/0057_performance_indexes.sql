CREATE INDEX "activity_events_actor_occurred_idx" ON "activity_events" USING btree ("actor_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "price_snapshots_day_printing_idx" ON "price_snapshots" USING btree ("day","printing_id","usd_cents");--> statement-breakpoint
CREATE INDEX "printings_lower_name_idx" ON "printings" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "printings_name_set_number_idx" ON "printings" USING btree ("name","set_code","collector_number");--> statement-breakpoint
CREATE INDEX "acquisitions_user_printing_finish_idx" ON "acquisitions" USING btree ("user_id","printing_id","finish","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "draft_seats_user_draft_idx" ON "draft_seats" USING btree ("user_id","draft_id") WHERE "draft_seats"."bot_number" = 0;--> statement-breakpoint
CREATE INDEX "sealed_items_owner_opened_idx" ON "sealed_items" USING btree ("owner_id","opened_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "sealed_items"."status" = 'opened';--> statement-breakpoint
CREATE INDEX "friendships_addressee_accepted_idx" ON "friendships" USING btree ("addressee_id","requester_id") WHERE "friendships"."status" = 'accepted';