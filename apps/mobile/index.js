import { registerRootComponent } from 'expo';
import Layout from './app/_layout';
let Root = Layout;
if (__DEV__ && process.env.EXPO_PUBLIC_NATIVE_PROBES === '1') {
  Root = require('./src/dev/NativeProbeScreen').default;
}
registerRootComponent(Root);
