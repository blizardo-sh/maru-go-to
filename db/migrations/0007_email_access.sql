ALTER TABLE users ADD COLUMN email_verification_required boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Invitations never proved ownership of a mailbox; existing learners keep access.
UPDATE users SET email_verified=false;
--> statement-breakpoint
ALTER TABLE access_links ADD COLUMN user_id text REFERENCES users(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE TABLE auth_limits (
 key text PRIMARY KEY,
 count integer NOT NULL,
 expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX auth_limits_expiry ON auth_limits(expires_at);
