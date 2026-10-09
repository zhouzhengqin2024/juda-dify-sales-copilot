CREATE TABLE `demo_rate_limits` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
