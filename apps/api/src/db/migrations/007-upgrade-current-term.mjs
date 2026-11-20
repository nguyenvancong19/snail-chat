export const upgradeCurrentTerm = `
  ALTER TABLE subscription_policy ADD COLUMN upgrade_fee_bps INTEGER NOT NULL DEFAULT 0
    CHECK(upgrade_fee_bps BETWEEN 0 AND 10000);
  ALTER TABLE subscription_orders ADD COLUMN upgrade_quote JSONB;

  UPDATE subscription_orders SET status='CANCELLED',
    review_reason='SnailChat đã ngừng hỗ trợ tự hạ gói. Nếu đã chuyển khoản, liên hệ quản trị viên để đối soát.'
    WHERE status='PENDING' AND change_kind='DOWNGRADE';
`;
