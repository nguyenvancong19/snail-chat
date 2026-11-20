export const workspaceEntitlements = `
  ALTER TABLE users ADD COLUMN preferred_shop_id TEXT REFERENCES shops(id) ON DELETE SET NULL;
  ALTER TABLE users ADD COLUMN avatar_version TEXT;
  CREATE TABLE user_avatars (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    image BYTEA NOT NULL CHECK(octet_length(image) BETWEEN 1 AND 2097152)
  );
  ALTER TABLE channels ADD COLUMN quota_paused BOOLEAN NOT NULL DEFAULT FALSE;
  CREATE INDEX channels_managed_shop ON channels(shop_id) WHERE NOT quota_paused;
  ALTER TABLE subscription_orders DROP CONSTRAINT subscription_orders_status_check;
  ALTER TABLE subscription_orders ADD CONSTRAINT subscription_orders_status_check
    CHECK(status IN ('PENDING','PAID','REVIEW','CANCELLED','SCHEDULED'));
  ALTER TABLE shops ADD COLUMN subscription_revision BIGINT NOT NULL DEFAULT 0;
  ALTER TABLE subscription_orders ADD COLUMN subscription_revision BIGINT NOT NULL DEFAULT 0;
  ALTER TABLE shops ADD COLUMN subscription_value_vnd BIGINT;
  ALTER TABLE shops ADD COLUMN subscription_value_since BIGINT;
  ALTER TABLE subscription_orders ADD COLUMN change_kind TEXT;
  ALTER TABLE subscription_orders ADD COLUMN list_price_vnd INTEGER;
  ALTER TABLE subscription_orders ADD COLUMN credit_vnd INTEGER;
  ALTER TABLE subscription_orders ADD COLUMN starts_at BIGINT;
  ALTER TABLE subscription_orders DROP CONSTRAINT subscription_orders_price_vnd_check;
  ALTER TABLE subscription_orders ADD CONSTRAINT subscription_orders_price_vnd_check CHECK(price_vnd>=0);
  CREATE UNIQUE INDEX subscription_scheduled_shop ON subscription_orders(shop_id) WHERE status='SCHEDULED';
  CREATE INDEX subscription_scheduled_due ON subscription_orders(starts_at) WHERE status='SCHEDULED';
  CREATE TABLE subscription_policy (
    id INTEGER PRIMARY KEY CHECK(id=1),
    upgrade_credit BOOLEAN NOT NULL DEFAULT TRUE,
    downgrade_timing TEXT NOT NULL DEFAULT 'END_OF_TERM' CHECK(downgrade_timing IN ('END_OF_TERM','IMMEDIATE'))
  );
  INSERT INTO subscription_policy(id) VALUES(1);

  CREATE TABLE subscription_changes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shop_id TEXT NOT NULL REFERENCES shops(id),
    admin_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    previous_plan TEXT NOT NULL, new_plan TEXT NOT NULL,
    expires_at BIGINT, created_at BIGINT NOT NULL
  );

  CREATE VIEW entitled_shop_channels AS
    SELECT c.id FROM channels c
    JOIN shops s ON s.id=c.shop_id
    JOIN subscription_plans f ON f.code='FREE'
    LEFT JOIN subscription_plans p ON p.code=s.subscription_plan
    WHERE NOT c.quota_paused
      AND (SELECT COUNT(*) FROM channels cp WHERE cp.shop_id=s.id AND NOT cp.quota_paused)
        <=COALESCE(s.subscription_page_limit,p.page_limit,f.page_limit)
      AND ((SELECT COUNT(*) FROM shop_members m WHERE m.shop_id=s.id AND m.role='STAFF' AND m.status='ACTIVE')
        +(SELECT COUNT(*) FROM shop_invitations i WHERE i.shop_id=s.id AND i.expires_at>extract(epoch FROM now())*1000))
        <=COALESCE(s.subscription_staff_limit,p.staff_limit,f.staff_limit);
`;
