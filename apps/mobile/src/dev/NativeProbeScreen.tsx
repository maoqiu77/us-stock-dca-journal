import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { fetch as nativeFetch } from 'expo/fetch';
import { probeSyntheticCrypto } from './native-capabilities';
import { ftsCloseStorageProbe, seedStorageProbe, reopenStorageProbe, missingKeyStorageProbe, afterReinstallStorageProbe } from './storage-probe';
import { fetchProbeWithoutRedirects } from './probe-transport';
const phases = ['fts-close','crypto','seed','reopen','missing-key','after-reinstall','network'] as const;
type Phase = typeof phases[number];
async function networkProbe() {
  const ok = await fetchProbeWithoutRedirects(nativeFetch,'https://localhost:8843/ok');
  if (ok.status!==200 || await ok.text()!=='SYNTHETIC TLS OK') throw new Error('controlled_tls_endpoint_unavailable');
  const rejected: string[]=[];
  for (const url of ['http://localhost:8843/ok','https://localhost:8843/redirect-same','https://localhost:8843/redirect-cross','https://localhost:8845/ok']) {
    try { await fetchProbeWithoutRedirects(nativeFetch,url); }
    catch { rejected.push(url); continue; }
    throw new Error('tls_or_redirect_boundary_failed');
  }
  return {controlled_tls_success:true,rejected_count:rejected.length,requires_host_redirect_target_zero_requests_check:true};
}
export default function NativeProbeScreen() {
  const [report,setReport]=useState('等待合成数据预检');
  const busy=useRef(false);
  async function run(phase:Phase) {
    if (!__DEV__ || Platform.OS!=='android' || busy.current) return;
    busy.current=true; setReport(`${phase} 执行中`);
    try {
      const result=phase==='fts-close'?await ftsCloseStorageProbe():phase==='crypto'?await probeSyntheticCrypto():phase==='seed'?await seedStorageProbe():phase==='reopen'?await reopenStorageProbe():phase==='missing-key'?await missingKeyStorageProbe():phase==='after-reinstall'?await afterReinstallStorageProbe():await networkProbe();
      const record={phase,status:'passed',result};
      console.log('NATIVE_PROBE_RESULT',JSON.stringify(record));setReport(JSON.stringify(record,null,2));
    } catch(error) {
      // Never log native objects or keys; all custom messages refer to synthetic checks.
      const record={phase,status:'failed',error:error instanceof Error?error.message:'unknown_probe_error'};
      console.log('NATIVE_PROBE_RESULT',JSON.stringify(record));setReport(JSON.stringify(record,null,2));
    } finally { busy.current=false; }
  }
  useEffect(()=>{
    function handle(url:string|null) {
      if(!url?.startsWith('portfolio-local://native-probe/'))return;
      const phase=url.slice('portfolio-local://native-probe/'.length);
      if(phases.includes(phase as Phase))void run(phase as Phase);
    }
    void Linking.getInitialURL().then(handle);
    const subscription=Linking.addEventListener('url',event=>handle(event.url));
    return ()=>subscription.remove();
  },[]);
  return <SafeAreaProvider><SafeAreaView style={{flex:1,backgroundColor:'#f5f5f2'}}><ScrollView contentContainerStyle={{padding:24,gap:16}}>
    <Text accessibilityRole="header" style={{fontSize:24,fontWeight:'700'}}>Android 原生预检</Text>
    <Text>仅合成数据 · 开发版专用</Text>
    {phases.map(phase=><Pressable key={phase} accessibilityRole="button" onPress={()=>void run(phase)} style={{padding:16,backgroundColor:'#d9e8df',borderRadius:8}}><Text>{phase}</Text></Pressable>)}
    <Text selectable>{report}</Text>
  </ScrollView></SafeAreaView></SafeAreaProvider>;
}
