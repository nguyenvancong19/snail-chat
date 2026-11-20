export const tenantSchema = `
  ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

  CREATE TABLE IF NOT EXISTS shops (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id),
    subscription_plan TEXT NOT NULL DEFAULT 'FREE', expired_at BIGINT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED')),
    created_at BIGINT NOT NULL DEFAULT (extract(epoch FROM clock_timestamp())*1000)::bigint
  );
  CREATE INDEX IF NOT EXISTS shops_owner ON shops(owner_id);

  CREATE TABLE IF NOT EXISTS shop_members (
    id TEXT PRIMARY KEY, shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('OWNER','STAFF')),
    status TEXT NOT NULL CHECK(status IN ('INVITED','ACTIVE','SUSPENDED')),
    joined_at BIGINT,
    UNIQUE(shop_id,user_id), UNIQUE(shop_id,id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS shops_single_owner ON shop_members(shop_id) WHERE role='OWNER';
  CREATE INDEX IF NOT EXISTS shop_members_active_user ON shop_members(user_id,shop_id) WHERE status='ACTIVE';

  ALTER TABLE channels ADD COLUMN IF NOT EXISTS shop_id TEXT REFERENCES shops(id);
  CREATE INDEX IF NOT EXISTS channels_shop ON channels(shop_id);
  CREATE UNIQUE INDEX IF NOT EXISTS channels_shop_id ON channels(shop_id,id);

  CREATE TABLE IF NOT EXISTS page_assignments (
    id TEXT PRIMARY KEY, shop_id TEXT NOT NULL,
    shop_member_id TEXT NOT NULL, page_id TEXT NOT NULL, permissions TEXT[] NOT NULL,
    FOREIGN KEY(shop_id,shop_member_id) REFERENCES shop_members(shop_id,id) ON DELETE CASCADE,
    FOREIGN KEY(shop_id,page_id) REFERENCES channels(shop_id,id) ON DELETE CASCADE,
    UNIQUE(shop_member_id,page_id),
    CHECK(cardinality(permissions)>0 AND permissions <@ ARRAY['chat:read','chat:reply','order:manage']::text[]),
    CHECK(NOT ('chat:reply'=ANY(permissions)) OR 'chat:read'=ANY(permissions))
  );

  CREATE TABLE IF NOT EXISTS shop_invitations (
    id TEXT PRIMARY KEY, shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    email TEXT NOT NULL, grants JSONB NOT NULL DEFAULT '[]',
    expires_at BIGINT NOT NULL, UNIQUE(shop_id,email)
  );
  CREATE INDEX IF NOT EXISTS shop_invitations_email ON shop_invitations(email,expires_at);
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS queued_by TEXT REFERENCES users(id);
  ALTER TABLE comments ADD COLUMN IF NOT EXISTS queued_by TEXT REFERENCES users(id);
  ALTER TABLE oauth ADD COLUMN IF NOT EXISTS shop_id TEXT REFERENCES shops(id) ON DELETE CASCADE;
  ALTER TABLE meta_choices ADD COLUMN IF NOT EXISTS shop_id TEXT REFERENCES shops(id) ON DELETE CASCADE;

  CREATE OR REPLACE FUNCTION notify_snailchat_page_activity() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) - 'reply_claim_until' - 'ghn_next') =
        (to_jsonb(NEW) - 'reply_claim_until' - 'ghn_next') THEN
        RETURN NULL;
      END IF;
      PERFORM pg_notify('snailchat_page_activity',json_build_object(
        'room','page:' || NEW.channel_id,
        'permission',CASE WHEN TG_TABLE_NAME IN ('shop_orders','order_verifications') THEN 'order:manage' ELSE 'chat:read' END
      )::text);
      RETURN NULL;
    END;
    $$;

  DO $$
  DECLARE target text;
  BEGIN
    FOREACH target IN ARRAY ARRAY['inbox_messages','messenger_page_messages','comments','shop_orders','order_verifications'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass(target) AND tgname='snailchat_page_activity') THEN
        EXECUTE format('CREATE TRIGGER snailchat_page_activity AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION notify_snailchat_page_activity()',target);
      END IF;
    END LOOP;
  END;
  $$;
`;

// A stable ID makes the backfill safe to repeat after a legacy import.
export const backfillShops = `
  INSERT INTO shops(id,name,owner_id)
    SELECT 'default:'||u.id,u.name||' · Shop',u.id FROM users u
    WHERE EXISTS (SELECT 1 FROM channels c WHERE c.owner_id=u.id AND c.shop_id IS NULL)
    ON CONFLICT(id) DO NOTHING;

  INSERT INTO shop_members(id,shop_id,user_id,role,status,joined_at)
    SELECT 'owner:'||s.owner_id,s.id,s.owner_id,'OWNER','ACTIVE',s.created_at FROM shops s
    WHERE s.id='default:'||s.owner_id
    ON CONFLICT(shop_id,user_id) DO NOTHING;

  UPDATE channels c SET shop_id=s.id FROM shops s
    WHERE c.shop_id IS NULL AND s.owner_id=c.owner_id AND s.id='default:'||c.owner_id;
`;
