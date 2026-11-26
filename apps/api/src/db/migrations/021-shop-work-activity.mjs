export const shopWorkActivitySchema = `
  CREATE TABLE shop_staff_codes (
    shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    number BIGINT NOT NULL CHECK (number>0),
    PRIMARY KEY(shop_id,user_id),
    UNIQUE(shop_id,number)
  );
  INSERT INTO shop_staff_codes(shop_id,user_id,number)
  SELECT shop_id,user_id,ROW_NUMBER() OVER (PARTITION BY shop_id ORDER BY joined_at NULLS LAST,id)
  FROM shop_members WHERE role='STAFF' AND status<>'INVITED';

  ALTER TABLE page_assignments DROP CONSTRAINT page_assignments_permissions_check,
    ADD CONSTRAINT page_assignments_permission_values CHECK(cardinality(permissions)>0 AND
      permissions <@ ARRAY['chat:read','chat:reply','order:manage','order:create']::text[]),
    ADD CONSTRAINT page_assignments_order_create_requires_view CHECK(
      NOT ('order:create'=ANY(permissions)) OR 'order:manage'=ANY(permissions));
  ALTER TABLE inbox_messages ADD COLUMN reply_actor JSONB;
  ALTER TABLE messenger_contacts ADD COLUMN takeover_actor JSONB;
  ALTER TABLE shop_orders ADD COLUMN created_actor JSONB;

  CREATE TABLE shop_work_events (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('takeover','extend','release','reply','order')),
    subject TEXT NOT NULL,
    at BIGINT NOT NULL,
    actor JSONB NOT NULL
  );
  CREATE INDEX shop_work_events_recent ON shop_work_events(shop_id,at DESC,id DESC);
  CREATE INDEX shop_work_events_subject ON shop_work_events(shop_id,channel_id,subject,at DESC,id DESC);
`;
