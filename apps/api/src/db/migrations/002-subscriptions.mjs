export const subscriptionSchema = `
  CREATE TABLE subscription_plans (
    code TEXT PRIMARY KEY CHECK(code IN ('FREE','BASIC','PRO')),
    name TEXT NOT NULL, description TEXT NOT NULL,
    page_limit INTEGER NOT NULL CHECK(page_limit BETWEEN 1 AND 100),
    staff_limit INTEGER NOT NULL CHECK(staff_limit BETWEEN 1 AND 200),
    duration_days INTEGER CHECK(duration_days BETWEEN 1 AND 365),
    price_vnd INTEGER CHECK(price_vnd BETWEEN 1000 AND 999999999),
    available BOOLEAN NOT NULL DEFAULT TRUE,
    CHECK((code='FREE' AND duration_days IS NULL AND price_vnd IS NULL) OR
          (code<>'FREE' AND duration_days IS NOT NULL))
  );
  INSERT INTO subscription_plans(code,name,description,page_limit,staff_limit,duration_days) VALUES
    ('FREE','Miễn phí','Dành cho Shop mới bắt đầu.',1,1,NULL),
    ('BASIC','Basic','Dành cho Shop cần thêm Page và nhân viên.',2,2,30),
    ('PRO','Pro','Dành cho Shop vận hành nhiều Page với đội ngũ lớn hơn.',3,5,30);

  ALTER TABLE shops ADD COLUMN subscription_page_limit INTEGER;
  ALTER TABLE shops ADD COLUMN subscription_staff_limit INTEGER;

  CREATE TABLE subscription_orders (
    id TEXT PRIMARY KEY CHECK(id ~ '^SC[A-F0-9]{12}$'),
    shop_id TEXT NOT NULL REFERENCES shops(id),
    plan_code TEXT NOT NULL REFERENCES subscription_plans(code) CHECK(plan_code<>'FREE'),
    plan_name TEXT NOT NULL,
    price_vnd INTEGER NOT NULL CHECK(price_vnd>0),
    page_limit INTEGER NOT NULL, staff_limit INTEGER NOT NULL, duration_days INTEGER NOT NULL,
    bank_code TEXT NOT NULL, account_number TEXT NOT NULL, account_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID','REVIEW')),
    created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
    paid_at BIGINT, subscription_until BIGINT, review_reason TEXT
  );
  CREATE INDEX subscription_orders_shop ON subscription_orders(shop_id,created_at DESC);
  CREATE TABLE sepay_receipts (
    transaction_id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES subscription_orders(id),
    amount_vnd BIGINT NOT NULL, received_at BIGINT NOT NULL,
    outcome TEXT NOT NULL CHECK(outcome IN ('PAID','REVIEW')),
    reference_code TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX sepay_receipts_order ON sepay_receipts(order_id);
  CREATE UNIQUE INDEX sepay_paid_order ON sepay_receipts(order_id) WHERE outcome='PAID';
`;
