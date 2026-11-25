export const aiProviderFailoverSchema = `
  ALTER TABLE openrouter_settings
    ADD COLUMN backup_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN backup_provider TEXT,
    ADD COLUMN backup_model TEXT,
    ADD COLUMN backup_api_key TEXT,
    ADD CONSTRAINT ai_backup_configuration CHECK (
      (backup_provider IS NULL AND backup_model IS NULL AND backup_api_key IS NULL)
      OR (backup_provider IS NOT NULL AND backup_model IS NOT NULL AND backup_model <> '' AND backup_api_key IS NOT NULL)
    ),
    ADD CONSTRAINT ai_backup_enabled CHECK (
      NOT backup_enabled OR (backup_provider IS NOT NULL AND backup_provider <> provider)
    );
`;
