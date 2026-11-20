import { get } from './store.mjs';
import { ensure } from '../http/validation.mjs';

export const pageSize=10;

export function pageNumber(value='1'){
  const page=Number(value);
  ensure(typeof value==='string'&&/^[1-9]\d*$/.test(value)&&Number.isSafeInteger(page)&&
    page<=Math.floor(Number.MAX_SAFE_INTEGER/pageSize),400,'Số trang không hợp lệ.');
  return page;
}

// SQL and order come from application code. Search and page values use parameters.
export function readPage(sql,order,args,page=1){
  return get(`WITH matched AS NOT MATERIALIZED (${sql}), totals AS (SELECT count(*) AS total FROM matched),
    bounds AS (SELECT total,LEAST($${args.length+1}::bigint,GREATEST(1,(total+${pageSize-1})/${pageSize})) AS page FROM totals)
    SELECT total,page,COALESCE((
      SELECT jsonb_agg(to_jsonb(batch) ORDER BY ${order}) FROM (
        SELECT * FROM matched ORDER BY ${order}
        LIMIT ${pageSize} OFFSET ((bounds.page-1)*${pageSize})
      ) batch
    ),'[]'::jsonb) AS items FROM bounds`,...args,page);
}
