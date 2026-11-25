import { get } from '../db/store.mjs';

export async function activeAiConfig() {
  return get(`SELECT provider, model, api_key, backup_enabled, backup_provider, backup_model, backup_api_key
    FROM openrouter_settings WHERE id=1 AND enabled AND api_key IS NOT NULL`);
}
