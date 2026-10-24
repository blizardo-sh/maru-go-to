CREATE TABLE study_progress (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('word','grammar','counter')),
 item_id text NOT NULL,
 introductions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(introductions)='array'),
 passed jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(passed)='array'),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id,kind,item_id)
);
