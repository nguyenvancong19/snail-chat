export const shopRenameSchema = `
  ALTER TABLE shops ADD COLUMN renamed_at BIGINT;
  CREATE TABLE shop_name_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    cooldown_days INTEGER NOT NULL CHECK(cooldown_days BETWEEN 0 AND 365)
  );
  INSERT INTO shop_name_settings(id,cooldown_days) VALUES(1,30);
`;
