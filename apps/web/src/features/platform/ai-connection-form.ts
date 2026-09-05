export function connectionAddress(value: string) {
  return value.trim().replace(/\/(responses|chat\/completions|messages)\/?$/, "").replace(/\/$/, "");
}

export function connectionError(message: string) {
  if (/\b401\b|invalid.*(?:api.?key|authentication)/i.test(message)) return "密钥无效或已过期，请检查是否粘贴了当前服务商的 API 密钥。";
  if (/\b402\b|insufficient.*(?:balance|quota)|余额不足/i.test(message)) return "账户余额或额度不足，请到服务商平台检查。";
  if (/\b403\b/i.test(message)) return "服务商拒绝了访问，请检查密钥权限和模型使用权限。";
  if (/\b429\b/i.test(message)) return "请求过于频繁或额度已用完，请稍后重试，并检查服务商额度。";
  if (/timed?\s*out|timeout/i.test(message)) return "连接超时，请检查网络，或稍后重试。";
  if (/\b404\b.*model|model.*not found|模型不存在/i.test(message)) return "找不到所选模型，请在高级设置中检查模型名称。";
  if (/\b404\b|\b405\b|\b501\b/i.test(message)) return "接口地址或协议不匹配，请按服务商说明检查高级设置。";
  if (/\b50[0234]\b/i.test(message)) return "服务商暂时无法响应，请稍后重试。";
  if (/failed to fetch|connection.*(?:error|refused)|name resolution/i.test(message)) return "暂时无法连接，请检查网络和接口地址。";
  return message;
}
