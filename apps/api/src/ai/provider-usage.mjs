import { all, run } from '../db/store.mjs';

const dayLength = 86_400_000;
const vietnamOffset = 7 * 3_600_000;

function dayBucket(timestamp) {
  return Math.floor((timestamp + vietnamOffset) / dayLength);
}

export async function recordProviderUsage(provider, startedAt, failed, reported, estimated) {
  try {
    await run(`INSERT INTO ai_provider_daily_usage
      (day_bucket,provider,calls,failed_calls,reported_tokens,estimated_tokens)
      VALUES ($1,$2,1,$3,$4,$5)
      ON CONFLICT (day_bucket,provider) DO UPDATE SET
        calls=ai_provider_daily_usage.calls+1,
        failed_calls=ai_provider_daily_usage.failed_calls+excluded.failed_calls,
        reported_tokens=ai_provider_daily_usage.reported_tokens+excluded.reported_tokens,
        estimated_tokens=ai_provider_daily_usage.estimated_tokens+excluded.estimated_tokens`,
      dayBucket(startedAt), provider, Number(failed), reported, estimated);
  } catch (error) {
    console.error('AI usage aggregation failed:', error.code ?? error.name);
  }
}

export async function providerUsage(days, provider, now = Date.now()) {
  const last = dayBucket(now);
  const first = last - days + 1;
  const rows = await all(`SELECT day_bucket, SUM(calls)::bigint AS calls, SUM(failed_calls)::bigint AS "failedCalls",
    SUM(reported_tokens)::bigint AS "reportedTokens", SUM(estimated_tokens)::bigint AS "estimatedTokens"
    FROM ai_provider_daily_usage
    WHERE day_bucket BETWEEN $1 AND $2 AND ($3='' OR provider=$3)
    GROUP BY day_bucket ORDER BY day_bucket`, first, last, provider);
  const byDay = new Map(rows.map(({day_bucket, ...counts}) => [day_bucket, counts]));
  const started = await all(`SELECT day_bucket FROM ai_provider_daily_usage
    WHERE $1='' OR provider=$1 ORDER BY day_bucket LIMIT 1`, provider);
  return {
    firstRecordedDay: started.length ? new Date(started[0].day_bucket * dayLength).toISOString().slice(0, 10) : null,
    items: Array.from({length: days}, (_, index) => {
      const bucket = first + index;
      return {
        date: new Date(bucket * dayLength).toISOString().slice(0, 10),
        ...(byDay.get(bucket) ?? {calls: 0, failedCalls: 0, reportedTokens: 0, estimatedTokens: 0}),
      };
    }),
  };
}
