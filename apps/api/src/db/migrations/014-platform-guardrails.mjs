export const platformGuardrailsSchema = `
  ALTER TABLE subscription_plans ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN ai_5h_tokens INTEGER NOT NULL DEFAULT 100000,
    ADD COLUMN ai_week_tokens INTEGER NOT NULL DEFAULT 500000,
    ADD CHECK(ai_5h_tokens>=0 AND ai_week_tokens>=ai_5h_tokens AND (ai_5h_tokens=0)=(ai_week_tokens=0));
  UPDATE subscription_plans SET ai_5h_tokens=0,ai_week_tokens=0 WHERE code='FREE';
  UPDATE subscription_plans SET ai_5h_tokens=300000,ai_week_tokens=1500000 WHERE code='PRO';
  ALTER TABLE shops ADD COLUMN version INTEGER NOT NULL DEFAULT 1, ADD COLUMN ai_cycle_anchor BIGINT;
  UPDATE shops SET ai_cycle_anchor=COALESCE(subscription_value_since,created_at);
  ALTER TABLE shops ALTER COLUMN ai_cycle_anchor SET DEFAULT (extract(epoch FROM clock_timestamp())*1000)::bigint;
  ALTER TABLE shops ALTER COLUMN ai_cycle_anchor SET NOT NULL;
  ALTER TABLE users ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE subscription_policy ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE shop_name_settings ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE openrouter_settings ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
  INSERT INTO openrouter_settings(id,enabled,model) VALUES(1,FALSE,'') ON CONFLICT DO NOTHING;
  CREATE INDEX login_attempts_expiry ON login_attempts(expires);

  CREATE FUNCTION advance_resource_version() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    NEW.version := OLD.version + 1;
    RETURN NEW;
  END; $$;
  CREATE TRIGGER plan_version BEFORE UPDATE ON subscription_plans FOR EACH ROW EXECUTE FUNCTION advance_resource_version();
  CREATE TRIGGER shop_version BEFORE UPDATE OF status,name,subscription_plan,expired_at,subscription_revision ON shops
    FOR EACH ROW EXECUTE FUNCTION advance_resource_version();
  CREATE TRIGGER user_version BEFORE UPDATE OF active,name,email ON users FOR EACH ROW EXECUTE FUNCTION advance_resource_version();
  CREATE TRIGGER billing_policy_version BEFORE UPDATE ON subscription_policy FOR EACH ROW EXECUTE FUNCTION advance_resource_version();
  CREATE TRIGGER shop_name_settings_version BEFORE UPDATE ON shop_name_settings FOR EACH ROW EXECUTE FUNCTION advance_resource_version();
  CREATE TRIGGER openrouter_version BEFORE UPDATE ON openrouter_settings FOR EACH ROW EXECUTE FUNCTION advance_resource_version();

  CREATE FUNCTION refresh_ai_cycle_anchor() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE now_ms BIGINT := (extract(epoch FROM clock_timestamp())*1000)::bigint;
  BEGIN
    IF OLD.subscription_plan='FREE' AND NEW.subscription_plan<>'FREE'
      OR OLD.expired_at<=now_ms AND NEW.expired_at>now_ms THEN
      NEW.ai_cycle_anchor := now_ms;
    END IF;
    RETURN NEW;
  END; $$;
  CREATE TRIGGER shop_ai_anchor BEFORE UPDATE OF subscription_plan,expired_at ON shops
    FOR EACH ROW EXECUTE FUNCTION refresh_ai_cycle_anchor();

  CREATE TABLE ai_token_windows (
    shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('5h','week')),
    starts_at BIGINT NOT NULL,
    tokens BIGINT NOT NULL CHECK(tokens>=0),
    PRIMARY KEY(shop_id,kind,starts_at)
  );
`;
