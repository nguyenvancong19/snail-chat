export const planOptionsSchema = `
  ALTER TABLE subscription_plans
    ADD COLUMN term_prices JSONB,
    ADD COLUMN page_addon_vnd INTEGER CHECK(page_addon_vnd>=0),
    ADD COLUMN staff_addon_vnd INTEGER CHECK(staff_addon_vnd>=0),
    ADD COLUMN feature_flags JSONB;
  ALTER TABLE subscription_orders ADD COLUMN pricing_selection JSONB;
`;
