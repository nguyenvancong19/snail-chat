import { access, all } from '../db/store.mjs';

const dayMs = 86_400_000;
const vietnamOffset = 7 * 3_600_000;
const dateKey = (day) => new Date(day * dayMs).toISOString().slice(0, 10);

export async function channelActivityChart(user, id, days, now = Date.now()) {
  const channel = await access(user, id);
  const last = Math.floor((now + vietnamOffset) / dayMs);
  const first = last - days + 1;
  const rows = await all(`WITH events AS (
    SELECT 'messages' AS kind,created FROM inbox_messages WHERE channel_id=$1 AND created >= $2 AND created <= $3
    UNION ALL
    SELECT 'comments',created FROM comments WHERE channel_id=$1 AND created >= $2 AND created <= $3
  ) SELECT (created+$4::bigint)/$5::bigint AS day,
    COUNT(*) FILTER (WHERE kind='messages') AS messages,
    COUNT(*) FILTER (WHERE kind='comments') AS comments
  FROM events GROUP BY day`, channel.id, first * dayMs - vietnamOffset, now, vietnamOffset, dayMs);
  const counts = new Map(rows.map(({day, ...count}) => [day, count]));
  return Array.from({length:days}, (_, index) => {
    const day = first + index;
    return {date:dateKey(day), messages:0, comments:0, ...counts.get(day)};
  });
}
