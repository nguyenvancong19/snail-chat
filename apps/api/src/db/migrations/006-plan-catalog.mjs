export const planCatalogSchema = `
  ALTER TABLE subscription_plans DROP CONSTRAINT subscription_plans_code_check;
  ALTER TABLE subscription_plans ADD CONSTRAINT subscription_plans_code_check CHECK(code ~ '^[A-Z][A-Z0-9_]{1,23}$');
  ALTER TABLE subscription_plans ADD COLUMN tier INTEGER;
  UPDATE subscription_plans SET tier=CASE code WHEN 'FREE' THEN 0 WHEN 'BASIC' THEN 10 WHEN 'PRO' THEN 20 END;
  ALTER TABLE subscription_plans ALTER COLUMN tier SET NOT NULL;
  ALTER TABLE subscription_plans ADD CONSTRAINT subscription_plans_tier_unique UNIQUE(tier);
  ALTER TABLE subscription_plans ADD CONSTRAINT subscription_plans_tier_check CHECK(
    (code='FREE' AND tier=0) OR (code<>'FREE' AND tier BETWEEN 1 AND 10000)
  );
  ALTER TABLE subscription_plans ADD COLUMN archived_at BIGINT;
  ALTER TABLE subscription_plans ADD CONSTRAINT subscription_plans_archive_check CHECK(
    archived_at IS NULL OR (code<>'FREE' AND NOT available)
  );
  ALTER TABLE subscription_plans ADD COLUMN benefits JSONB NOT NULL DEFAULT '[]'::jsonb;
`;
