CREATE TABLE prior_learning (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('word','grammar')),
 item_id text NOT NULL,
 created_modes jsonb NOT NULL CHECK (jsonb_typeof(created_modes)='array'),
 reviewed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id,kind,item_id)
);
--> statement-breakpoint
CREATE TABLE prior_learning_actions (
 request_id text PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 payload jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
