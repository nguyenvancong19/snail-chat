export const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user')),
    active INTEGER NOT NULL DEFAULT 1, email_verified_at BIGINT
  );
  -- Preserve access for accounts provisioned before email verification existed.
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at BIGINT DEFAULT 0;
  ALTER TABLE users ALTER COLUMN email_verified_at DROP DEFAULT;
  CREATE TABLE IF NOT EXISTS email_verifications (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL, expires BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS email_verifications_user ON email_verifications(user_id);
  CREATE INDEX IF NOT EXISTS email_verifications_expiry ON email_verifications(expires);
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL, expires BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets(user_id);
  CREATE INDEX IF NOT EXISTS password_resets_expiry ON password_resets(expires);
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS session_refresh_tokens (
    token_hash TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    used BOOLEAN NOT NULL DEFAULT FALSE
  );
  CREATE INDEX IF NOT EXISTS session_refresh_tokens_session ON session_refresh_tokens(session_id);
  CREATE UNIQUE INDEX IF NOT EXISTS session_refresh_tokens_active ON session_refresh_tokens(session_id) WHERE NOT used;
  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, handle TEXT NOT NULL,
    platform TEXT NOT NULL CHECK(platform IN ('fb','ig')), topic TEXT NOT NULL DEFAULT '',
    voice TEXT NOT NULL DEFAULT '', days TEXT NOT NULL DEFAULT '[]', time TEXT NOT NULL DEFAULT '20:00',
    bot_mode TEXT NOT NULL DEFAULT 'off', rules TEXT NOT NULL DEFAULT '',
    meta_id TEXT, token TEXT, expires BIGINT, webhook INTEGER NOT NULL DEFAULT 0,
    owner_id TEXT REFERENCES users(id),
    UNIQUE(platform,meta_id)
  );
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS messenger INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS message_bot_mode TEXT NOT NULL DEFAULT 'off';
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS message_rules TEXT NOT NULL DEFAULT '';
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS comment_policy JSONB;
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS message_bot_policy JSONB;
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS message_greeting TEXT NOT NULL DEFAULT 'welcome';
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS message_personalize BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS facebook_feed_comment_at BIGINT;
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS facebook_feed_comment_result TEXT;
  UPDATE channels SET message_bot_mode='off' WHERE message_bot_mode='auto';
  CREATE TABLE IF NOT EXISTS access (
    user_id TEXT NOT NULL REFERENCES users(id), channel_id TEXT NOT NULL REFERENCES channels(id),
    PRIMARY KEY(user_id,channel_id)
  );
  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id),
    title TEXT NOT NULL, filename TEXT NOT NULL, bytes INTEGER NOT NULL,
    created BIGINT NOT NULL DEFAULT (extract(epoch from clock_timestamp()) * 1000)::bigint
  );
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id),
    video_id TEXT NOT NULL REFERENCES videos(id), title TEXT NOT NULL, caption TEXT NOT NULL,
    scheduled BIGINT NOT NULL, status TEXT NOT NULL, bot_mode TEXT NOT NULL, rules TEXT NOT NULL DEFAULT '',
    ai INTEGER NOT NULL DEFAULT 0, error TEXT, remote_id TEXT, alias_id TEXT, permalink TEXT,
    step TEXT, upload_url TEXT, next_check BIGINT NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
    claim_until BIGINT NOT NULL DEFAULT 0, uncertain INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS posts_remote ON posts(channel_id,remote_id,alias_id);
  CREATE TABLE IF NOT EXISTS post_bot_settings (
    channel_id TEXT NOT NULL REFERENCES channels(id), media_id TEXT NOT NULL,
    bot_mode TEXT NOT NULL CHECK(bot_mode IN ('inherit','off','review','auto')), rules TEXT NOT NULL,
    PRIMARY KEY(channel_id,media_id)
  );
  ALTER TABLE post_bot_settings ADD COLUMN IF NOT EXISTS comment_policy JSONB;
  CREATE TABLE IF NOT EXISTS facebook_comment_sync (
    channel_id TEXT NOT NULL, media_id TEXT NOT NULL,
    enabled_at BIGINT NOT NULL, next_check BIGINT NOT NULL DEFAULT 0,
    synced_at BIGINT, last_error TEXT,
    PRIMARY KEY(channel_id,media_id),
    FOREIGN KEY(channel_id,media_id) REFERENCES post_bot_settings(channel_id,media_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS facebook_comment_sync_due ON facebook_comment_sync(next_check);
  ALTER TABLE facebook_comment_sync ADD COLUMN IF NOT EXISTS scan_after TEXT;
  ALTER TABLE facebook_comment_sync ADD COLUMN IF NOT EXISTS scan_started_at BIGINT;
  ALTER TABLE facebook_comment_sync ADD COLUMN IF NOT EXISTS failures INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY, post_id TEXT REFERENCES posts(id),
    channel_id TEXT NOT NULL REFERENCES channels(id), remote_id TEXT NOT NULL,
    author TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL,
    reply TEXT, automatic INTEGER NOT NULL DEFAULT 0, created BIGINT NOT NULL,
    bot_category TEXT NOT NULL DEFAULT '', reply_claim_until BIGINT NOT NULL DEFAULT 0,
    UNIQUE(channel_id,remote_id)
  );
  ALTER TABLE comments ALTER COLUMN post_id DROP NOT NULL;
  ALTER TABLE comments ADD COLUMN IF NOT EXISTS media_id TEXT;
  ALTER TABLE comments ADD COLUMN IF NOT EXISTS reply_error TEXT;
  ALTER TABLE comments ADD COLUMN IF NOT EXISTS reply_sent_at BIGINT;
  ALTER TABLE comments ADD COLUMN IF NOT EXISTS facebook_key TEXT GENERATED ALWAYS AS (
    CASE WHEN remote_id ~ '^[0-9]+_[0-9]+$' THEN split_part(remote_id,'_',2) ELSE remote_id END
  ) STORED;
  ALTER TABLE comments ADD COLUMN IF NOT EXISTS facebook_media_key TEXT GENERATED ALWAYS AS (
    CASE WHEN media_id ~ '^[0-9]+_[0-9]+$' THEN split_part(media_id,'_',2) ELSE media_id END
  ) STORED;
  CREATE INDEX IF NOT EXISTS comments_facebook_key ON comments(channel_id,facebook_media_key,facebook_key);
  CREATE TABLE IF NOT EXISTS facebook_private_replies (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    comment_key TEXT NOT NULL, status TEXT NOT NULL,
    started BIGINT NOT NULL, message_id TEXT, error TEXT,
    PRIMARY KEY(channel_id,comment_key)
  );
  ALTER TABLE facebook_private_replies ADD COLUMN IF NOT EXISTS automatic BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE comments ADD COLUMN IF NOT EXISTS agent_public_policy JSONB;
  ALTER TABLE comments ADD COLUMN IF NOT EXISTS private_ai_job BIGINT;
  ALTER TABLE comments ADD COLUMN IF NOT EXISTS private_ai_draft TEXT;
  CREATE INDEX IF NOT EXISTS comments_private_ai_pending ON comments(created) WHERE private_ai_job IS NOT NULL;
  CREATE TABLE IF NOT EXISTS facebook_comment_links (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    media_key TEXT NOT NULL,
    comment_key TEXT NOT NULL,
    parent_remote_id TEXT NOT NULL,
    parent_key TEXT GENERATED ALWAYS AS (
      CASE WHEN parent_remote_id ~ '^[0-9]+_[0-9]+$' THEN split_part(parent_remote_id,'_',2) ELSE parent_remote_id END
    ) STORED,
    PRIMARY KEY(channel_id,media_key,comment_key),
    CHECK(comment_key<>parent_key)
  );
  CREATE INDEX IF NOT EXISTS facebook_comment_links_parent ON facebook_comment_links(channel_id,media_key,parent_key);
  CREATE TABLE IF NOT EXISTS inbox_messages (
    id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id),
    remote_id TEXT NOT NULL, sender_id TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL,
    reply TEXT, automatic INTEGER NOT NULL DEFAULT 0, created BIGINT NOT NULL,
    bot_category TEXT NOT NULL DEFAULT '', reply_claim_until BIGINT NOT NULL DEFAULT 0,
    UNIQUE(channel_id,remote_id)
  );
  ALTER TABLE comments ADD COLUMN IF NOT EXISTS bot_suggestion TEXT;
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS conversation_ai BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS bot_suggestion TEXT;
  ALTER TABLE comments ADD COLUMN IF NOT EXISTS bot_blocked BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS bot_blocked BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE comments ADD COLUMN IF NOT EXISTS automatic_ack INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS automatic_ack INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS greeting TEXT;
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS reply_error TEXT;
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS sent_at BIGINT;
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS reply_request_id TEXT;
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS previous_replies JSONB NOT NULL DEFAULT '[]';
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]';
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS inbound_quote_mid TEXT;
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS reply_payload JSONB;
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS reply_remote_id TEXT;
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS greeting_remote_id TEXT;
  CREATE TABLE IF NOT EXISTS messenger_page_messages (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    remote_id TEXT NOT NULL, recipient_id TEXT NOT NULL, created BIGINT NOT NULL,
    text TEXT NOT NULL, attachments JSONB NOT NULL DEFAULT '[]', quote_mid TEXT, app_id TEXT,
    PRIMARY KEY(channel_id,remote_id)
  );
  ALTER TABLE messenger_page_messages ADD COLUMN IF NOT EXISTS sales_sku TEXT;
  CREATE INDEX IF NOT EXISTS messenger_page_messages_thread ON messenger_page_messages(channel_id,recipient_id,created DESC);
  CREATE TABLE IF NOT EXISTS messenger_uploads (
    message_id TEXT NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    content_type TEXT NOT NULL,
    data BYTEA NOT NULL,
    PRIMARY KEY(message_id,request_id)
  );
  CREATE TABLE IF NOT EXISTS messenger_templates (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    command TEXT NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY(channel_id,command)
  );
  ALTER TABLE messenger_templates ADD COLUMN IF NOT EXISTS image_name TEXT;
  ALTER TABLE messenger_templates ADD COLUMN IF NOT EXISTS image_type TEXT;
  ALTER TABLE messenger_templates ADD COLUMN IF NOT EXISTS image_data BYTEA;
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS page_purpose TEXT NOT NULL DEFAULT 'sales';
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS page_knowledge TEXT NOT NULL DEFAULT '';
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS catalog_mode TEXT NOT NULL DEFAULT 'off';
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS catalog_image_url TEXT;
  CREATE TABLE IF NOT EXISTS catalog_products (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sku TEXT NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL CHECK(price>=0),
    in_stock BOOLEAN NOT NULL, image_url TEXT NOT NULL,
    PRIMARY KEY(channel_id,sku)
  );
  ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS detail_images JSONB NOT NULL DEFAULT '[]';
  ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
  CREATE TABLE IF NOT EXISTS agent_documents (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    filename TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK(purpose IN ('general','sales','policy','support','tone')),
    content TEXT NOT NULL,
    created BIGINT NOT NULL,
    PRIMARY KEY(channel_id,id)
  );
  CREATE TABLE IF NOT EXISTS catalog_files (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    filename TEXT NOT NULL,
    category TEXT NOT NULL,
    created BIGINT NOT NULL,
    PRIMARY KEY(channel_id,id)
  );
  ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS source_file_id TEXT;
  DO $$ BEGIN
    ALTER TABLE catalog_products ADD CONSTRAINT catalog_products_source_file_fk
      FOREIGN KEY(channel_id,source_file_id) REFERENCES catalog_files(channel_id,id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS sales_ai BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS sales_sku TEXT;
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS order_ai_mode TEXT NOT NULL DEFAULT 'off';
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS orders_enabled BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS order_auto BOOLEAN NOT NULL DEFAULT FALSE;
  CREATE TABLE IF NOT EXISTS order_drafts (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL, code TEXT NOT NULL, sku TEXT NOT NULL, quantity INTEGER NOT NULL,
    unit_price INTEGER NOT NULL, customer TEXT, phone TEXT, address TEXT, expires BIGINT NOT NULL,
    PRIMARY KEY(channel_id,sender_id)
  );
  CREATE TABLE IF NOT EXISTS shop_orders (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    code TEXT NOT NULL, sender_id TEXT NOT NULL, sku TEXT NOT NULL, product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99), unit_price INTEGER NOT NULL CHECK(unit_price>=0),
    customer TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('new','packing','shipping','delivered','cancelled')),
    tracking TEXT NOT NULL DEFAULT '', created BIGINT NOT NULL, updated BIGINT NOT NULL,
    history JSONB NOT NULL DEFAULT '[]',
    PRIMARY KEY(channel_id,code)
  );
  CREATE INDEX IF NOT EXISTS shop_orders_page_recent ON shop_orders(channel_id,created DESC,code DESC);
  ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS carrier TEXT;
  ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS shipment JSONB;
  CREATE TABLE IF NOT EXISTS shop_carriers (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    carrier TEXT NOT NULL CHECK(carrier IN ('ghn','ghtk')),
    sealed_token TEXT NOT NULL, account_ref TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(channel_id,carrier)
  );
  ALTER TABLE shop_carriers ADD COLUMN IF NOT EXISTS auto_config JSONB;
  ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS archived_at BIGINT;
  ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS ghn_config JSONB;
  ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS ghn_shop TEXT;
  ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS ghn_next BIGINT;
  ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS ghn_attempts INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS ghn_error TEXT;
  CREATE INDEX IF NOT EXISTS shop_orders_ghn_jobs ON shop_orders(ghn_next) WHERE ghn_next IS NOT NULL;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS ui_theme JSONB NOT NULL DEFAULT '{}';
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS order_templates JSONB NOT NULL DEFAULT '{}';
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS order_cases JSONB NOT NULL DEFAULT '[]';
  CREATE TABLE IF NOT EXISTS verified_buyers (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL, phone TEXT NOT NULL, verified_at BIGINT NOT NULL,
    PRIMARY KEY(channel_id,sender_id,phone)
  );
  CREATE INDEX IF NOT EXISTS verified_buyers_phone ON verified_buyers(channel_id,phone);
  CREATE TABLE IF NOT EXISTS order_verifications (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    code TEXT NOT NULL, sender_id TEXT NOT NULL, sku TEXT NOT NULL, quantity INTEGER NOT NULL,
    unit_price INTEGER NOT NULL, customer TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL,
    confirmed_at BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','verified','approved','rejected')),
    approved_product_name TEXT, notice TEXT, notice_message_id TEXT,
    PRIMARY KEY(channel_id,code)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS order_verifications_pending ON order_verifications(channel_id,sender_id)
    WHERE status IN ('pending','verified');
  CREATE INDEX IF NOT EXISTS order_verifications_notices ON order_verifications(confirmed_at)
    WHERE notice IS NOT NULL AND notice_message_id IS NULL;
  ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS sales_inquiry BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE order_drafts ADD COLUMN IF NOT EXISTS items JSONB;
  ALTER TABLE order_verifications ADD COLUMN IF NOT EXISTS items JSONB;
  ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS items JSONB;
  ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS bot_created BOOLEAN NOT NULL DEFAULT TRUE;
  CREATE INDEX IF NOT EXISTS inbox_sales_inquiry ON inbox_messages(channel_id,created,sender_id) WHERE sales_inquiry;
  CREATE TABLE IF NOT EXISTS openrouter_settings (
    id INTEGER PRIMARY KEY CHECK(id=1), enabled BOOLEAN NOT NULL, model TEXT NOT NULL, api_key TEXT
  );
  UPDATE comments SET status='review',reply=NULL,automatic=0 WHERE status='queued' AND automatic=1 AND automatic_ack=0;
  UPDATE inbox_messages SET status='review',reply=NULL,automatic=0 WHERE status='queued' AND automatic=1 AND automatic_ack=0;
  CREATE TABLE IF NOT EXISTS messenger_contacts (
    channel_id TEXT NOT NULL REFERENCES channels(id),
    sender_id TEXT NOT NULL,
    last_inbound BIGINT NOT NULL,
    PRIMARY KEY (channel_id,sender_id)
  );
  ALTER TABLE messenger_contacts ADD COLUMN IF NOT EXISTS display_name TEXT;
  ALTER TABLE messenger_contacts ADD COLUMN IF NOT EXISTS profile_refresh_at BIGINT NOT NULL DEFAULT 0;
  CREATE INDEX IF NOT EXISTS inbox_messages_sender ON inbox_messages(channel_id,sender_id,created DESC);
  CREATE INDEX IF NOT EXISTS inbox_messages_queue ON inbox_messages(status,created);
  CREATE INDEX IF NOT EXISTS inbox_messages_channel_created ON inbox_messages(channel_id,created DESC);
  CREATE INDEX IF NOT EXISTS comments_channel_created ON comments(channel_id,created DESC);
CREATE TABLE IF NOT EXISTS oauth (
  state TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  channel_id TEXT REFERENCES channels(id), platform TEXT NOT NULL CHECK(platform IN ('fb','ig')),
  expires BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta_choices (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  channel_id TEXT REFERENCES channels(id), expires BIGINT NOT NULL, choices TEXT NOT NULL
);
  CREATE TABLE IF NOT EXISTS login_attempts (
    key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS channels_owner ON channels(owner_id);
  CREATE INDEX IF NOT EXISTS comments_queue ON comments(status,created);
  CREATE TABLE IF NOT EXISTS notification_reads (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('comment','message')),
    item_id TEXT NOT NULL,
    PRIMARY KEY(user_id,kind,item_id)
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
`;
