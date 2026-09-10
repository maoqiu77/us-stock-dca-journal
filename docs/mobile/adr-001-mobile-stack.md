# ADR 001：Mobile 原生预检候选（blocked，尚未批准为产品实现）

日期：2026-09-09；Android 实测更新：2026-09-10。范围：实施计划 M07；不切换 Flutter，不使用明文兜底，不将 Expo Go/Jest/Metro 结果视为原生证明。

## 候选与依据

- Expo **55.0.31**；React Native **0.83.10**；Mobile React **19.2.0**。使用 SDK 55 稳定线而非追逐最新 SDK；精确 RN patch 和 SDK 模块范围来自发布包 `expo@55.0.31/bundledNativeModules.json`，兼容主版本依据 [Expo SDK 55 表](https://docs.expo.dev/versions/v55.0.0/)。该表要求 Xcode 26.2+、Android compile/target SDK 36。
- expo-dev-client **55.0.40**、expo-sqlite **55.0.20**、expo-secure-store **55.0.18**，所有直接依赖精确写入 manifest，唯一根 lockfile 固定完整树。
- SQLite 插件开启 `useSQLCipher` 与 `enableFTS`。依据 [SDK 55 SQLite](https://docs.expo.dev/versions/v55.0.0/sdk/sqlite/)，SQLCipher 必须原生构建；当前没有普通 SQLite 替代路径。
- SecureStore 候选依据 [SDK 55 SecureStore](https://docs.expo.dev/versions/v55.0.0/sdk/securestore/)。Android `allowBackup:false`，本地配置插件进一步排除全部应用数据的云备份与设备迁移；iOS Keychain 可能跨卸载保留、Android 卸载后密钥行为不同，生命周期与 iOS DB 备份排除仍必须设备实测。
- 优先评估 react-native-quick-crypto **1.1.7**、react-native-nitro-modules **0.37.1**、react-native-quick-base64 **3.0.1**。安装包 [官方 README](https://github.com/margelo/react-native-quick-crypto/blob/main/README.md) 指出 1.x 使用新架构/Nitro、最低 RN 0.75；这只构成候选依据，**不能证明所选 RN patch 实际兼容**。dev 模块提供合成 AES-GCM 往返/篡改、PBKDF2-SHA256 公共向量及 600000 次性能探针。Android API36 模拟器已通过，600000 次约34.97ms；不外推为真机性能。
- Android 已验证 `expo/fetch`：HTTPS 正常响应、HTTP与无效证书拒绝、同源/跨源重定向拒绝且服务端目标请求数为0。预检固定合成认证标记；业务 adapter 留在 M21，iOS transport 未测试。

## Monorepo 决策

Web React 保持 **19.2.4**。Metro 将所有 react 子路径解析到 Mobile 19.2.0；全仓 RN 只有 0.83.10。依照 [Expo Monorepo](https://docs.expo.dev/guides/monorepos/) 使用默认 Metro 配置和 autolinkingModuleResolution。

三个空入口使用 React Native 自身的 Pressable/View 与局部页面状态；M07 不需要路由框架。最初评估的 Expo Router 在分离 React 的 workspace 中引入重复原生 peer，npm 去重又出现 ERESOLVE，因此从最小候选壳移除。没有强行统一 Web React，也没有保留强制安装参数、override 或 preset 内部补丁。后续业务导航留到已授权 M12，由实际需求决定。

## 当前裁决

Android 本地构建与预检现已执行，结果见 [android-validation-2026-09-10.md](android-validation-2026-09-10.md)。FTS 连接使用 `finalizeUnusedStatementsBeforeClosing:false` 避免 Expo #38168 的内部语句重复释放，应用语句必须自行 finally 释放。用户要求 iOS 延后，因此 M07 双平台总门禁仍 blocked，不把模拟器结果冒充真机结果；M08–M17/M19–M27 尚未开始。
