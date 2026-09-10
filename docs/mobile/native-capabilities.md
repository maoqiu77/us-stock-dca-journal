# M07 原生能力预检记录

本机：macOS 26.6.2 arm64，Node 24.16.0，npm 11.13.0。所有例子为合成数据，未连接真实 Provider 或读取旧账户。

## 2026-09-09 初始工具链证据（历史）

- `xcode-select -p`：`/Library/Developer/CommandLineTools`。
- `xcodebuild -version`：requires Xcode；`xcrun simctl` 不可用；未找到 `/Applications/Xcode.app`。
- `/usr/bin/java -version`：Unable to locate a Java Runtime；未找到 Android SDK/platform-tools/adb。
- `npm --workspace @portfolio/mobile run native:android`：退出 **1**，缺少 JDK/Android SDK。
- `npm --workspace @portfolio/mobile run native:ios`：退出 **1**，缺少完整 Xcode/模拟器。
- `check:native-evidence`：读取 `native-evidence.json`，两平台 blocked，必须退出 **1**。

初始预检未安装系统工具；后经用户明确授权，已安装 Android Studio/JDK/SDK/模拟器与 Xcode。未申请云构建或签名账号。壳仅有持仓/记录/Copilot 三个开发状态页，没有模拟业务数据。

## 双平台完整验收清单（Android结果见最新记录）

1. 本机准备 Xcode 26.2+ 与可启动 iOS 15.1+ 模拟器；JDK、Android SDK 36/platform-tools 与可启动设备。记录实际 OS、设备、构建标识。
2. 根 `npm ci`；Mobile typecheck/test；`native:android` / `native:ios` 运行真正的 `expo run:<platform> --no-bundler` 本地构建。按需要用开发客户端启动 Metro；不使用 Expo Go 代替。
3. 在开发专用 harness 接入 `src/dev/native-capabilities.ts`（当前未接入任何产品路由）。仅用合成密码/文本验证 AES-GCM 往返/篡改和 PBKDF2 向量及性能。重启/SQLCipher/生命周期/transport harness 尚未实现或运行，不能直接把此 crypto 探针当全套预检。
4. 补齐 SQLCipher 合成文件写入→强退→重启读取；普通 sqlite 拒读；错误/丢失 key 拒绝且不重建空库；SecureStore 冷启动/卸载与 Keychain 遗留；Android/iOS DB 和密钥系统备份排除。
5. TLS-only 与不同 origin/相同 origin redirect 拒绝必须用受控测试端点观察原生请求，不传真实 key。FTS 中文词/全文回退验证实际命中，记录 KDF 600000 次耗时。
6. 两平台保存单 React bundle、单 RN autolinking、发行包无探针的证据。将经人工审核的非敏感结论填入 `native-evidence.json`，每个 requiredChecks 项包括具体 evidence，绑定当前根 lockfile SHA256。原始设备捕获放在已忽略的 `apps/mobile/native-artifacts/`。
7. 运行 `check:native-evidence`；全部通过后才能继续 M08。校验器检查报告完整性与 lock hash，不伪装成能验证人工证据真实性的工具。

## 当前状态（2026-09-10）

用户指定仅 Android 测试；Android storage/transport 开发预检入口已实现并在 API36 ARM64 模拟器运行。具体结果与FTS修复见 [Android实测](android-validation-2026-09-10.md)。iOS已安装工具但按用户要求延后，不能标通过。双平台总门禁仍 blocked。Node测试涵盖证据门禁和transport参数/timeout，不替代设备验收。选型详见 ADR001。

## 已通过的主机检查

最终 `npm ci`、Mobile typecheck、1项证据门禁测试、Expo依赖检查与 autolinking verify 均退出0。去掉不必要的 Router 候选后无原生重复模块警告。最终 Metro export 的 Android/iOS sourcemap 各仅 `/apps/mobile/node_modules/react`，无 dev 探针；lock 中 RN 唯一版本为0.83.10。这些只证明主机依赖与 bundle，不证明实际设备能力。完整最终记录见 validation-2026-09-09.md。
