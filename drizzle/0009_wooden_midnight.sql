ALTER TABLE `proxy_debug_traces` ADD `request_id` text REFERENCES proxy_requests(id);--> statement-breakpoint
CREATE INDEX `proxy_debug_traces_request_id_idx` ON `proxy_debug_traces` (`request_id`);