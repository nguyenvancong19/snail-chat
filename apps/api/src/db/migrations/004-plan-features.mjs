export const planFeaturesSchema = `
  ALTER TABLE subscription_plans ADD COLUMN agent_mode TEXT NOT NULL DEFAULT 'OFF'
    CHECK(agent_mode IN ('OFF','SCHEDULED','ALWAYS'));
  ALTER TABLE subscription_plans ADD COLUMN agent_start SMALLINT;
  ALTER TABLE subscription_plans ADD COLUMN agent_end SMALLINT;
  ALTER TABLE subscription_plans ADD COLUMN order_management BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE subscription_plans ADD CONSTRAINT subscription_plan_agent_schedule CHECK(
    (agent_mode='SCHEDULED' AND agent_start IS NOT NULL AND agent_end IS NOT NULL
      AND agent_start BETWEEN 0 AND 1439 AND agent_end BETWEEN 0 AND 1439 AND agent_start<>agent_end)
    OR (agent_mode<>'SCHEDULED' AND agent_start IS NULL AND agent_end IS NULL));
  UPDATE subscription_plans SET agent_mode='SCHEDULED',agent_start=360,agent_end=1140,order_management=TRUE WHERE code='BASIC';
  UPDATE subscription_plans SET agent_mode='ALWAYS',order_management=TRUE WHERE code='PRO';
`;
