export const agentAlertSoundsSchema = `
  CREATE TABLE IF NOT EXISTS shop_alert_sounds (
    shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('order','product','customer')),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    filename TEXT,
    mime TEXT,
    audio BYTEA,
    PRIMARY KEY(shop_id,kind)
  );

  ALTER TABLE order_verifications ADD COLUMN IF NOT EXISTS customer_check_required BOOLEAN NOT NULL DEFAULT TRUE;

  CREATE OR REPLACE FUNCTION notify_snailchat_agent_alert() RETURNS trigger
  LANGUAGE plpgsql AS $$
  DECLARE kind text; source text; target text;
  BEGIN
    IF TG_TABLE_NAME = 'inbox_messages' THEN
      IF NEW.order_review IS NULL OR NEW.order_review->>'decision' IS NOT NULL THEN RETURN NULL; END IF;
      IF TG_OP = 'UPDATE' AND OLD.order_review IS NOT NULL THEN RETURN NULL; END IF;
      kind := 'product'; source := NEW.id; target := 'messages';
    ELSIF TG_TABLE_NAME = 'shop_orders' THEN
      IF NOT NEW.bot_created AND NOT EXISTS (
        SELECT 1 FROM order_verifications v WHERE v.channel_id=NEW.channel_id AND v.code=NEW.code
          AND v.sender_id=NEW.sender_id AND v.status='verified' AND v.notice_message_id IS NOT NULL
      ) THEN RETURN NULL; END IF;
      kind := 'order'; source := NEW.code; target := 'orders';
    ELSE
      IF NEW.status <> 'pending' THEN RETURN NULL; END IF;
      kind := CASE WHEN NEW.customer_check_required THEN 'customer' ELSE 'product' END;
      source := NEW.code; target := 'verification';
    END IF;
    PERFORM pg_notify('snailchat_page_activity', json_build_object(
      'room','page:' || NEW.channel_id,
      'permission',CASE WHEN target='messages' THEN 'chat:reply' ELSE 'order:manage' END,
      'alert',json_build_object('kind',kind,'target',target,'source',source)
    )::text);
    RETURN NULL;
  END;
  $$;

  CREATE TRIGGER snailchat_agent_alert AFTER INSERT OR UPDATE OF order_review ON inbox_messages
    FOR EACH ROW EXECUTE FUNCTION notify_snailchat_agent_alert();
  CREATE TRIGGER snailchat_agent_alert AFTER INSERT ON shop_orders
    FOR EACH ROW EXECUTE FUNCTION notify_snailchat_agent_alert();
  CREATE TRIGGER snailchat_agent_alert AFTER INSERT ON order_verifications
    FOR EACH ROW EXECUTE FUNCTION notify_snailchat_agent_alert();
`;
