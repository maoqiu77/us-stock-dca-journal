# AI 额度规则（2026-09-21 更新）

用户最终选择：普通用户每天免费 10 次，指定的开发者测试微信账号个人次数不限。之前累计 20 次方案已被替代，生产配置不启用 lifetimeLimit。

- 每次云端受理分析或追问计 1 次，失败 / 结果未知也计次。重复查询与幂等重试不重复扣次。
- 日额度沿用 UTC 日期，每天北京时间 08:00 重置；保存在服务端 ai_usage，换设备或清空本地数据不会重置。
- portfolioAi 环境变量 AI_UNLIMITED_PRINCIPAL_HASHES 保存 SHA256(可信 OPENID) 名单。仅服务端配置可豁免个人额度，不接受请求参数授权。
- 豁免账号仍受 maxInflight=1、平台每日 1000 次预算约束，模型费用正常产生。
- 新客户端通过 capabilities_version=2 获取 limits.unlimited；旧客户端协议保持兼容，新展示需使用新版客户端。

## 部署验证

2026-09-21 已确认当前测试账号身份来自可信 capabilities 响应，将其哈希配置到既有 portfolioAi 环境变量；AI_DAILY_REQUEST_LIMIT 已核实为 10。未将真实账号标识或名单写入仓库。

已通过微信开发者工具“上传并部署：云端安装依赖”部署 portfolioAi。部署后只读 capabilities 实测：dailyRequests=10、unlimited=true、globalDailyRequests=1000、maxInflight=1。设置页实际显示“当前账号：个人 AI 对话不限次数 · 处理中 0 次”。未使用另一真实微信账号作验收；普通账号第 11 次拒绝、客户端伪造豁免无效及豁免账号可超过个人上限已由注入测试验证。

网关测试 90/90，小程序页面与运行时回归 60/60，类型检查与生产构建检查通过。未新增模型调用，未上传或发布小程序客户端。
