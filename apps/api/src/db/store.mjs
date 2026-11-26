import { shopWorkActivitySchema } from './migrations/021-shop-work-activity.mjs';
import { shopAiDailyUsageSchema } from './migrations/020-shop-ai-daily-usage.mjs';
import { aiProviderFailoverSchema } from './migrations/019-ai-provider-failover.mjs';
import { aiProvidersSchema } from './migrations/018-ai-providers.mjs';
import { workspaceAccessSchema } from './migrations/017-workspace-access.mjs';
import { aiWalletSchema } from './migrations/016-ai-wallet.mjs';
import { platformGuardrailsSchema } from './migrations/014-platform-guardrails.mjs';
import { listPaginationSchema } from './migrations/013-list-pagination.mjs';
import { planPromotionsSchema } from './migrations/012-plan-promotions.mjs';
import { agentAlertSoundsSchema } from './migrations/011-agent-alert-sounds.mjs';
import { agentProductReviewSchema } from './migrations/010-agent-product-review.mjs';
import { inboxWorkflowSchema } from './migrations/009-inbox-workflow.mjs';
import { planOptionsSchema } from './migrations/008-plan-options.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { schema } from './schema.mjs';
import { tenantSchema, backfillShops } from './migrations/001-shops.mjs';
import { subscriptionSchema } from './migrations/002-subscriptions.mjs';
import { workspaceEntitlements } from './migrations/003-workspace-entitlements.mjs';
import { planFeaturesSchema } from './migrations/004-plan-features.mjs';
import { planCatalogSchema } from './migrations/006-plan-catalog.mjs';
import { shopRenameSchema } from './migrations/005-shop-rename.mjs';
import { upgradeCurrentTerm } from './migrations/007-upgrade-current-term.mjs';
import { AppError, ensure } from '../http/validation.mjs';

export const uid = randomUUID;
// All bigint values in the schema are counts, file sizes or JavaScript epoch milliseconds.
pg.types.setTypeParser(20, Number);
export const db = new pg.Pool({ max: 12, connectionTimeoutMillis: 5000 });
db.on('error', (error) => console.error('Idle PostgreSQL connection error:', error.code ?? error.name));

const currentClient = new AsyncLocalStorage();
const query = (sql, values) => (currentClient.getStore() ?? db).query(sql, values);
export const get = async (sql, ...args) => (await query(sql, args)).rows[0];
export const all = async (sql, ...args) => (await query(sql, args)).rows;
export const run = async (sql, ...args) => ({ changes: (await query(sql, args)).rowCount });

export async function transaction(work) {
  if (currentClient.getStore()) return work();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await currentClient.run(client, work);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function initializeDatabase() {
  await transaction(async () => {
    await run('SELECT pg_advisory_xact_lock(1608463910)');
    await run(schema);
    await run(`CREATE TABLE IF NOT EXISTS display_translations (
      locale TEXT NOT NULL, source_hash TEXT NOT NULL, translated TEXT NOT NULL,
      PRIMARY KEY(locale,source_hash)
    )`);
    await run('CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY)');
    if(!await get("SELECT id FROM schema_migrations WHERE id='001-shops'")){
      await run(tenantSchema);
      await run("UPDATE users SET is_super_admin=TRUE WHERE role='admin'");
      await run(backfillShops);
      await run("INSERT INTO schema_migrations(id) VALUES('001-shops')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='002-subscriptions'")){
      await run(subscriptionSchema);
      await run("INSERT INTO schema_migrations(id) VALUES('002-subscriptions')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='003-workspace-entitlements'")){
      await run(workspaceEntitlements);
      await run("INSERT INTO schema_migrations(id) VALUES('003-workspace-entitlements')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='004-plan-features'")){
      await run(planFeaturesSchema);
      await run("INSERT INTO schema_migrations(id) VALUES('004-plan-features')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='005-shop-rename'")){
      await run(shopRenameSchema);
      await run("INSERT INTO schema_migrations(id) VALUES('005-shop-rename')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='006-plan-catalog'")){
      await run(planCatalogSchema);
      await run("INSERT INTO schema_migrations(id) VALUES('006-plan-catalog')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='007-upgrade-current-term'")){
      await run(upgradeCurrentTerm);
      await run("INSERT INTO schema_migrations(id) VALUES('007-upgrade-current-term')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='008-plan-options'")){
      await run(planOptionsSchema);
      await run("INSERT INTO schema_migrations(id) VALUES('008-plan-options')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='009-inbox-workflow'")){
      await run(inboxWorkflowSchema);
      await run("INSERT INTO schema_migrations(id) VALUES('009-inbox-workflow')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='010-agent-product-review'")){
      await run(agentProductReviewSchema);
      await run("INSERT INTO schema_migrations(id) VALUES('010-agent-product-review')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='011-agent-alert-sounds'")){
      await run(agentAlertSoundsSchema);
      await run("INSERT INTO schema_migrations(id) VALUES('011-agent-alert-sounds')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='012-plan-promotions'")){
      await run(planPromotionsSchema);
      await run("INSERT INTO schema_migrations(id) VALUES('012-plan-promotions')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='013-list-pagination'")){
      await run(listPaginationSchema);
      await run("INSERT INTO schema_migrations(id) VALUES('013-list-pagination')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='014-platform-guardrails'")){
      await run(platformGuardrailsSchema);
      await run("INSERT INTO schema_migrations(id) VALUES('014-platform-guardrails')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='015-max-ai-allowance'")){
      await run(`UPDATE subscription_plans SET ai_5h_tokens=1000000,ai_week_tokens=10000000
        WHERE (code='MAX' OR lower(trim(name))='max') AND archived_at IS NULL
          AND ai_5h_tokens=100000 AND ai_week_tokens=500000`);
      await run("INSERT INTO schema_migrations(id) VALUES('015-max-ai-allowance')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='016-ai-wallet'")){
      await run(aiWalletSchema);
      await run("INSERT INTO schema_migrations(id) VALUES('016-ai-wallet')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='017-workspace-access'")){
      await run(workspaceAccessSchema);
      await run("INSERT INTO schema_migrations(id) VALUES('017-workspace-access')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='018-ai-providers'")){
      await run(aiProvidersSchema);
      await run("INSERT INTO schema_migrations(id) VALUES('018-ai-providers')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='019-ai-provider-failover'")){
      await run(aiProviderFailoverSchema);
      await run("INSERT INTO schema_migrations(id) VALUES('019-ai-provider-failover')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='020-shop-ai-daily-usage'")){
      await run(shopAiDailyUsageSchema);
      await run("INSERT INTO schema_migrations(id) VALUES('020-shop-ai-daily-usage')");
    }
    if(!await get("SELECT id FROM schema_migrations WHERE id='021-shop-work-activity'")){
      await run(shopWorkActivitySchema);
      await run("INSERT INTO schema_migrations(id) VALUES('021-shop-work-activity')");
    }
  });
}

export async function access(user, channelId, permission='OWNER') {
  ensure(user?.currentShop,403,'Hãy chọn một Shop đang hoạt động.');
  const channel=await get(`SELECT c.* FROM channels c JOIN entitled_shop_channels entitlement ON entitlement.id=c.id
    JOIN shops s ON s.id=c.shop_id AND s.status='ACTIVE' AND (s.expired_at IS NULL OR s.expired_at>$5)
    JOIN shop_members m ON m.shop_id=s.id AND m.user_id=$3 AND m.status='ACTIVE'
    WHERE c.id=$1 AND c.shop_id=$2 AND (m.role='OWNER' OR EXISTS (
      SELECT 1 FROM page_assignments a WHERE a.shop_member_id=m.id AND a.page_id=c.id
        AND ($4='ANY' OR $4=ANY(a.permissions))))`,channelId??'',user.currentShop.id,user.id,permission,Date.now());
  return ensure(channel,404,'Không tìm thấy Page hoặc bạn chưa được cấp quyền thao tác.');
}

export async function throttle(key, max, windowMs) {
  const now = Date.now();
  const result = await run(`INSERT INTO login_attempts (key,count,expires) VALUES ($1,1,$2)
    ON CONFLICT (key) DO UPDATE
    SET count=CASE WHEN login_attempts.expires<=$3 THEN 1 ELSE login_attempts.count+1 END,
        expires=CASE WHEN login_attempts.expires<=$3 THEN $2 ELSE login_attempts.expires END
    WHERE login_attempts.expires<=$3 OR login_attempts.count<$4`, key, now + windowMs, now, max);
  if(!result.changes){
    const blocked=await get('SELECT expires FROM login_attempts WHERE key=$1',key);
    const error=new AppError(429,'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.');
    error.retryAfter=Math.max(1,Math.ceil(((blocked?.expires??now+windowMs)-Date.now())/1000));
    throw error;
  }
}
