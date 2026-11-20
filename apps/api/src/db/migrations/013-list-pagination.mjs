export const listPaginationSchema = `
  ALTER TABLE users ADD COLUMN created_at BIGINT;
  ALTER TABLE users ALTER COLUMN created_at SET DEFAULT (extract(epoch FROM clock_timestamp())*1000)::bigint;
  ALTER TABLE channels ADD COLUMN created_at BIGINT;
  ALTER TABLE channels ALTER COLUMN created_at SET DEFAULT (extract(epoch FROM clock_timestamp())*1000)::bigint;
  ALTER TABLE catalog_products ADD COLUMN created_at BIGINT;
  ALTER TABLE catalog_products ALTER COLUMN created_at SET DEFAULT (extract(epoch FROM clock_timestamp())*1000)::bigint;
  ALTER TABLE messenger_templates ADD COLUMN created_at BIGINT;
  ALTER TABLE messenger_templates ALTER COLUMN created_at SET DEFAULT (extract(epoch FROM clock_timestamp())*1000)::bigint;
`;
