export const shopAiDailyUsageSchema = `
  CREATE TABLE ai_shop_daily_usage (
    shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    day_bucket INTEGER NOT NULL,
    plan_tokens BIGINT NOT NULL CHECK(plan_tokens >= 0),
    PRIMARY KEY(shop_id, day_bucket)
  );
`;
