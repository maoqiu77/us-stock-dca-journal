import './validation-config.ts';
import '@formatjs/intl-getcanonicallocales/polyfill-force';
import '@formatjs/intl-locale/polyfill-force';
import '@formatjs/intl-pluralrules/polyfill-force';
import '@formatjs/intl-pluralrules/locale-data/en';
import '@formatjs/intl-numberformat/polyfill-force';
import '@formatjs/intl-numberformat/locale-data/en';
import '@formatjs/intl-datetimeformat/polyfill-force';
import '@formatjs/intl-datetimeformat/locale-data/en';
import '@formatjs/intl-datetimeformat/add-golden-tz';
import { createService } from './service.ts';

export function today() {
  // Account calendar is explicit Asia/Shanghai; no implicit device timezone.
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function id() {
  // Local record identity only; never use this generator for secrets or sessions.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const n = Math.floor(Math.random() * 16); return (char === 'x' ? n : (n & 3) | 8).toString(16);
  });
}
export const service = createService({
  get(key) { const raw: unknown = wx.getStorageSync(key); if (raw === '') return ''; if (typeof raw !== 'string') throw Error('invalid_storage_type'); return raw; },
  set(key, value) { wx.setStorageSync(key, value); },
  info() { const { currentSize, limitSize } = wx.getStorageInfoSync(); return { currentSize, limitSize }; },
}, { today, now: () => new Date().toISOString(), id });
export function showError(error: unknown) {
  wx.showModal({ title: '未完成操作', content: error instanceof Error ? error.message : '操作失败，请重试。', showCancel: false });
}
