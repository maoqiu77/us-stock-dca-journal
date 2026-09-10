# Android 原生预检（2026-09-10）

按用户要求本轮只测试 Android，iOS 延后。测试对象是新安装的合成预检应用，不读取旧 Web 数据，不调用真实 Provider。

## 环境与构建

- macOS arm64；Android Studio / JDK17 / Android SDK36 已安装，环境脚本 `~/.config/portfolio-mobile/android-env.sh`。
- AVD `Portfolio_API_36`，Pixel 8 / Android16 API36 / arm64，`emulator-5554`，SwiftShader。
- Expo55.0.31 / RN0.83.10 / Mobile React19.2.0，根 lockfile 锁定。
- 应用 ID `local.portfolio.journal`；本地 debug APK，Metro8081。未使用云构建、商店签名。
- UI 预检入口仅在 `__DEV__ && EXPO_PUBLIC_NATIVE_PROBES=1` 时加载；`portfolio-local://native-probe/<phase>` 触发单项测试。

## 已复现并修复的 FTS 连接关闭崩溃

原始连接选项下，FTS中文查询已返回，随后 `closeAsync()` 触发 SIGABRT，`libexpo-sqlite.so` 堆栈含 `exsqlite3_finalize`；两次复现。普通表冷启动读取及错误密钥测试不触发。对应 [Expo #38168](https://github.com/expo/expo/issues/38168)：自动遍历释放会碰到 FTS 自己管理的内部语句。

预检连接使用 `finalizeUnusedStatementsBeforeClosing:false`；`getFirstAsync/runAsync` 在内部 finally 释放各自语句，FTS负责内部语句。相同 `fts-close` 用例调整后成功查询并关闭。后续 M08 adapter 必须继承此连接策略并确保所有显式 prepared statement 在 finally 释放；不能靠不关闭连接绕过。

## 初次实测

- SQLCipher `4.7.0 community`；合成库 28672 bytes。普通 Python sqlite3 只读访问报 `file is not a database`，没有 SQLite 明文头。
- 首次进程崩溃后重启读取成功，SecureStore 密钥持久化，错误密钥查询拒绝，正确密钥随后仍可读取。
- 删除合成密钥后，在打开数据库前拒绝。前后 DB SHA256 均为 `df6319d7378b0c15f2b4a865321d0f9144bd8d8849acda6cb5839dc00ea17279`，没有创建明文替代库或覆盖原库。
- 中文 FTS：空格分词样本命中1条；有界 `instr` 匹配连续中文和分词中文共2条。不能将全文未命中视作无历史。
- Quick Crypto1.1.7：AES-256-GCM往返及密文篡改拒绝；PBKDF2-SHA256公开向量正确。600000次耗时34.97ms，仅代表该模拟器；真机耗时与参数仍需另测。

后续结果见下方追加记录。所有原始日志、证书和合成数据库在忽略目录 `apps/mobile/native-artifacts/`，不进入源码归档。测试 TLS CA 仅注入 Android debug 资源；不开系统信任、不关闭证书校验。

## 最后一轮验收

- 本地 `:app:assembleDebug` 成功（2m6s）。测试版 APK SHA256：`f75fcd0c29693c0fef1765b51eb5e74bd24580cad6ad3df1a3c5a5f692846635`；根 lock SHA256：`2e1600a4d8701321b844bd9d95a261e18d9ba09168a1ec7ed39d647689badb38`。
- 11:20:38 在全新安装中 seed 完整通过，包括 FTS/checkpoint/关闭；强退后新进程4714于11:21:20 reopen通过。
- 保留已写入的SecureStore密钥直接卸载并重装；新进程4883于11:21:41确认SecureStore为null。此前主动删key测试与本项分开，避免误判重装生命周期。
- 11:20:45 网络测试通过。受控服务器日志只有8843端口的 `/ok`、`/redirect-same`、`/redirect-cross`，均为合成认证标记；没有 `/target` 请求。无效证书端口8845未收到HTTP请求，HTTP输入在JS边界阻止。
- 本机临时 CA 只限 debug 的 localhost 域信任；不修改系统信任，不对实际 Provider 放宽TLS校验。开发 Metro 所需 cleartext 设置不代表业务 transport 可用HTTP。
- 已安装包没有 `ALLOW_BACKUP` 标志；`bmgr backupnow` 返回 `Backup is not allowed`。实际APK的提取规则为cloud-backup/device-transfer各9个domain排除。未实测厂商专属迁移工具，不声称对所有OEM成立。
- `:app:processReleaseResources` 成功（25s）；实际 release `.ap_` 不含测试 CA/网络配置，release Gradle sourcemap 不含 `src/dev/`。另一次 production Metro export 单React且无预检源码。没有构建/发布商店签名release APK。
- 完成后关闭测试端点、移除debug CA注入并切回普通三入口开发壳；测试私钥与原始日志均留在忽略目录，不纳入源码。

Android requiredChecks 已记录到 `native-evidence.json`。iOS因用户要求延后仍为blocked，双平台 `check:native-evidence` 应退出1。M07整体和其后置任务不声称完成；当前成果是Android模拟器原生预检通过。
