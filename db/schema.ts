import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const demoRateLimits = sqliteTable("demo_rate_limits", {
  bucketKey: text("bucket_key").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
