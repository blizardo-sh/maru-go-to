ALTER TABLE content_publications DROP CONSTRAINT content_publications_format_version_check;
--> statement-breakpoint
ALTER TABLE content_publications ADD CONSTRAINT content_publications_format_version_check CHECK (format_version IN (1, 2, 3));
