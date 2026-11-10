CREATE TABLE kana_states (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 script text NOT NULL CHECK (script IN ('hiragana','katakana')),
 direction text NOT NULL CHECK (direction IN ('sign-reading','reading-sign')),
 glyph text NOT NULL,
 version integer NOT NULL DEFAULT 0,
 card jsonb NOT NULL,
 due timestamptz NOT NULL,
 PRIMARY KEY(user_id,script,direction,glyph)
);
--> statement-breakpoint
CREATE INDEX kana_states_due ON kana_states(user_id,due);
--> statement-breakpoint
CREATE TABLE kana_attempts (
 attempt_id uuid PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 payload jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX kana_attempts_owner ON kana_attempts(user_id);
