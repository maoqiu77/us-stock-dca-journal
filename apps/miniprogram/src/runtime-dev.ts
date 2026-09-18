import { createCloudTransport } from './ai/cloud-transport.ts';
import { createCloudMarketTransport } from './market/cloud-transport.ts';
import { fakeAiProvider } from './ai/fake-provider.ts';
import { demoSnapshot } from './dev-fixtures.ts';
import { createRuntimeService, showError, today } from './runtime-core.ts';

const config = (globalThis as any).__PORTFOLIO_CONFIG__ as { aiTransport?: string; aiFunctionName?: string; marketFunctionName?: string } | undefined;
const aiTransport = config?.aiTransport === 'cloud' ? createCloudTransport(options => wx.cloud.callFunction(options as any) as any, config.aiFunctionName ?? '') : undefined;
const marketTransport = config?.marketFunctionName ? createCloudMarketTransport(options => wx.cloud.callFunction(options as any) as any, config.marketFunctionName) : undefined;
export const service = createRuntimeService({ aiTransport, marketTransport, fakeProvider: fakeAiProvider, demoFactory: demoSnapshot });
export const buildInfo = { version: (config as any)?.version ?? '', profile: (config as any)?.profile ?? '' };
export { showError, today };
