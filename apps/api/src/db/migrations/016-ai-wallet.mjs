export const aiWalletSchema=`
  ALTER TABLE subscription_plans ADD COLUMN ai_reset_limit INTEGER NOT NULL DEFAULT 0 CHECK(ai_reset_limit BETWEEN 0 AND 100);
  ALTER TABLE ai_token_windows ADD COLUMN reserved BIGINT NOT NULL DEFAULT 0 CHECK(reserved>=0),
    ADD COLUMN blocked_need BIGINT NOT NULL DEFAULT 0;
  ALTER TABLE shops ADD COLUMN ai_wallet_tokens BIGINT NOT NULL DEFAULT 0 CHECK(ai_wallet_tokens>=0),
    ADD COLUMN ai_wallet_reserved BIGINT NOT NULL DEFAULT 0 CHECK(ai_wallet_reserved>=0),
    ADD CHECK(ai_wallet_reserved<=ai_wallet_tokens);
  CREATE TABLE ai_reset_periods (
    shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    starts_at BIGINT NOT NULL, used INTEGER NOT NULL CHECK(used>0),
    PRIMARY KEY(shop_id,starts_at)
  );
  CREATE TABLE ai_token_reservations (
    id TEXT PRIMARY KEY, shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    five_start BIGINT NOT NULL, week_start BIGINT NOT NULL, included BIGINT NOT NULL,
    wallet BIGINT NOT NULL, expires BIGINT NOT NULL
  );
  CREATE INDEX ai_token_reservations_pending ON ai_token_reservations(shop_id,expires);
  CREATE TABLE ai_topup_settings (
    id INTEGER PRIMARY KEY CHECK(id=1), enabled BOOLEAN NOT NULL DEFAULT FALSE,
    tokens INTEGER NOT NULL DEFAULT 1000000 CHECK(tokens BETWEEN 1 AND 1000000000),
    price_vnd INTEGER NOT NULL DEFAULT 50000 CHECK(price_vnd BETWEEN 1000 AND 999999999),
    version INTEGER NOT NULL DEFAULT 1
  );
  INSERT INTO ai_topup_settings(id) VALUES(1);
  CREATE TRIGGER ai_topup_version BEFORE UPDATE ON ai_topup_settings
    FOR EACH ROW EXECUTE FUNCTION advance_resource_version();
  CREATE TABLE ai_topup_orders (
    id TEXT PRIMARY KEY, shop_id TEXT NOT NULL REFERENCES shops(id),
    tokens INTEGER NOT NULL CHECK(tokens>0), price_vnd INTEGER NOT NULL CHECK(price_vnd>0),
    bank_code TEXT NOT NULL, account_number TEXT NOT NULL, account_name TEXT NOT NULL,
    created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL, paid_at BIGINT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','REVIEW','PAID')),
    review_reason TEXT
  );
  CREATE INDEX ai_topup_shop_history ON ai_topup_orders(shop_id,created_at DESC,id DESC);
  CREATE TABLE ai_topup_receipts (
    transaction_id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES ai_topup_orders(id),
    amount_vnd BIGINT NOT NULL, received_at BIGINT NOT NULL,
    outcome TEXT NOT NULL CHECK(outcome IN ('PAID','REVIEW')), reference_code TEXT NOT NULL
  );
  CREATE UNIQUE INDEX ai_topup_paid_once ON ai_topup_receipts(order_id) WHERE outcome='PAID';
  CREATE INDEX ai_topup_receipt_order ON ai_topup_receipts(order_id,received_at DESC);
`;
