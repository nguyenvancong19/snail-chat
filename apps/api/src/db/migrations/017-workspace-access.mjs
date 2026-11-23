export const workspaceAccessSchema = `
  ALTER TABLE channels ALTER COLUMN page_purpose SET DEFAULT 'news';

  CREATE FUNCTION notify_snailchat_access() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE row_data jsonb;
  DECLARE shop_key text;
  DECLARE user_key text;
  BEGIN
    IF TG_OP = 'DELETE' THEN row_data := to_jsonb(OLD);
    ELSE row_data := to_jsonb(NEW);
    END IF;

    IF TG_TABLE_NAME = 'users' THEN
      user_key := row_data->>'id';
    ELSIF TG_TABLE_NAME = 'shops' THEN
      shop_key := row_data->>'id';
    ELSIF TG_TABLE_NAME = 'subscription_plans' THEN
      PERFORM pg_notify('snailchat_page_activity',
        json_build_object('access','shop:' || id)::text)
      FROM shops WHERE subscription_plan = row_data->>'code';
    ELSE
      shop_key := row_data->>'shop_id';
      IF TG_TABLE_NAME = 'shop_members' THEN user_key := row_data->>'user_id';
      END IF;
    END IF;

    IF TG_TABLE_NAME IN ('users','shops','subscription_plans') THEN
      PERFORM pg_notify('snailchat_page_activity','{"access":"admin"}');
    END IF;
    IF shop_key IS NOT NULL THEN
      PERFORM pg_notify('snailchat_page_activity',json_build_object('access','shop:' || shop_key)::text);
    END IF;
    IF user_key IS NOT NULL THEN
      PERFORM pg_notify('snailchat_page_activity',json_build_object('access','user:' || user_key)::text);
    END IF;
    RETURN NULL;
  END;
  $$;

  CREATE TRIGGER access_user AFTER UPDATE OF active, is_super_admin ON users
    FOR EACH ROW WHEN (OLD.active IS DISTINCT FROM NEW.active OR OLD.is_super_admin IS DISTINCT FROM NEW.is_super_admin)
    EXECUTE FUNCTION notify_snailchat_access();
  CREATE TRIGGER access_shop AFTER UPDATE OF status, subscription_plan, expired_at, subscription_revision,
    subscription_page_limit, subscription_staff_limit ON shops
    FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION notify_snailchat_access();
  CREATE TRIGGER access_plan AFTER INSERT OR UPDATE OR DELETE ON subscription_plans FOR EACH ROW EXECUTE FUNCTION notify_snailchat_access();
  CREATE TRIGGER access_member AFTER INSERT OR UPDATE OR DELETE ON shop_members
    FOR EACH ROW EXECUTE FUNCTION notify_snailchat_access();
  CREATE TRIGGER access_assignment AFTER INSERT OR UPDATE OR DELETE ON page_assignments
    FOR EACH ROW EXECUTE FUNCTION notify_snailchat_access();
  CREATE TRIGGER access_invitation AFTER INSERT OR UPDATE OR DELETE ON shop_invitations
    FOR EACH ROW EXECUTE FUNCTION notify_snailchat_access();
  CREATE TRIGGER access_channel AFTER INSERT OR DELETE OR UPDATE OF page_purpose, quota_paused, orders_enabled
    ON channels FOR EACH ROW EXECUTE FUNCTION notify_snailchat_access();
`;
