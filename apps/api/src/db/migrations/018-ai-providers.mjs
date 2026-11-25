export const aiProvidersSchema = `
  ALTER TABLE openrouter_settings ADD COLUMN provider TEXT NOT NULL DEFAULT 'openrouter'
    CHECK (provider ~ '^[a-z][a-z0-9-]{0,47}$');

  CREATE TABLE ai_provider_daily_usage (
    day_bucket INTEGER NOT NULL,
    provider TEXT NOT NULL CHECK (provider ~ '^[a-z][a-z0-9-]{0,47}$'),
    calls BIGINT NOT NULL DEFAULT 0,
    failed_calls BIGINT NOT NULL DEFAULT 0,
    reported_tokens BIGINT NOT NULL DEFAULT 0,
    estimated_tokens BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day_bucket, provider)
  );
`;
