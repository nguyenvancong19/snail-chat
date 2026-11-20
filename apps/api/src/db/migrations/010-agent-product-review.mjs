export const agentProductReviewSchema=`
  ALTER TABLE inbox_messages ADD COLUMN order_review JSONB;
  UPDATE inbox_messages SET order_review='{"items":[]}'::jsonb
    WHERE status='review' AND reply_error IN (
      'Khách quan tâm đặt hàng. Shop kiểm tra sản phẩm và số lượng.',
      'Shop kiểm tra số lượng khách muốn đặt.'
    ) AND created>extract(epoch FROM clock_timestamp())*1000-86400000;
`;
