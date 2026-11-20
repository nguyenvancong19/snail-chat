export const planPromotionsSchema = `
  ALTER TABLE subscription_plans ADD COLUMN term_promotions JSONB NOT NULL DEFAULT '{}';
  ALTER TABLE subscription_orders ADD COLUMN promotion_quote JSONB;
`;
