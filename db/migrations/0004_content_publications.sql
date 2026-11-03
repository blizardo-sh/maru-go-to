CREATE TABLE content_publications (
 id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
 format_version integer NOT NULL CHECK (format_version = 1),
 bundle jsonb NOT NULL,
 legacy boolean NOT NULL DEFAULT false,
 bundled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX content_one_legacy ON content_publications (legacy) WHERE legacy;
--> statement-breakpoint
CREATE TABLE content_active (
 singleton integer PRIMARY KEY DEFAULT 1 CHECK (singleton = 1),
 publication_id text NOT NULL REFERENCES content_publications(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE learning_states ADD COLUMN publication_id text REFERENCES content_publications(id);
