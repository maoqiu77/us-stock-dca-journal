import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const platform = process.argv[2];
if (!['android','ios'].includes(platform)) throw new Error('Expected android or ios');
const check = (cmd,args) => spawnSync(cmd,args,{encoding:'utf8'}).status === 0;
if (platform === 'ios' && (!check('xcodebuild',['-version']) || !check('xcrun',['simctl','list','devices']))) {
  console.error('BLOCKED: full Xcode and an iOS simulator are required.'); process.exit(1);
}
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(process.env.HOME,'Library/Android/sdk');
if (platform === 'android' && (!check('java',['-version']) || !existsSync(join(sdk,'platform-tools','adb')))) {
  console.error('BLOCKED: JDK and Android SDK/platform-tools are required.'); process.exit(1);
}
const result = spawnSync('npx',['--no-install','expo',`run:${platform}`,'--no-bundler'],{stdio:'inherit',env:{...process.env,EXPO_NO_TELEMETRY:'1'}});
process.exit(result.status ?? 1);
