import { createDeepSeekProvider, type CredentialMode, type ModelProvider } from './providers/deepseek.ts';

export type ProviderSelection = { provider: 'deepseek'; protocol: 'openai-compatible-chat-completions'; baseUrl: 'https://api.deepseek.com'; model: 'deepseek-flash' };
export type ResolvedProvider = { provider: ModelProvider; credentialMode: CredentialMode; selection: ProviderSelection };
export interface ProviderResolver { resolve(owner: string, requestedMode?: CredentialMode): Promise<ResolvedProvider>; configured(): boolean; byokEnabled(): boolean; }
export type SponsoredProviderConfig = ProviderSelection & { apiKey: string; timeoutMs: number; maxOutputTokens: number; byokEnabled: boolean };

export function createProviderResolver(config: SponsoredProviderConfig): ProviderResolver {
  const valid = config.provider === 'deepseek' && config.protocol === 'openai-compatible-chat-completions' && config.baseUrl === 'https://api.deepseek.com' && config.model === 'deepseek-flash' && !!config.apiKey;
  return {
    configured: () => valid,
    byokEnabled: () => config.byokEnabled,
    async resolve(_owner, requestedMode = 'sponsored') {
      if (requestedMode === 'byok') {
        if (!config.byokEnabled) throw Error('BYOK_DISABLED');
        throw Error('BYOK_CREDENTIAL_VAULT_NOT_CONFIGURED');
      }
      if (!valid) throw Error('SERVICE_NOT_CONFIGURED');
      return { credentialMode: 'sponsored', selection: { provider: config.provider, protocol: config.protocol, baseUrl: config.baseUrl, model: config.model }, provider: createDeepSeekProvider({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, timeoutMs: config.timeoutMs, maxOutputTokens: config.maxOutputTokens, credentialMode: 'sponsored' }) };
    },
  };
}
