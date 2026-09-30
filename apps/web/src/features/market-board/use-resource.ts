"use client";
import * as React from 'react';
import {createRequestGate} from './requests';
export function useResource<T>(key:string,loader:(signal:AbortSignal)=>Promise<T>,delay=0) {
 const [result,setResult]=React.useState<{key:string;data?:T;error?:string}|null>(null);
 React.useEffect(()=>{
  const gate=createRequestGate();const task=gate.start();
  const timer=window.setTimeout(()=>{void loader(task.signal).then(data=>{if(task.isCurrent())setResult({key,data});}).catch(error=>{if(task.isCurrent())setResult({key,error:error instanceof Error?error.message:'加载失败，请重试'});});},delay);
  return ()=>{window.clearTimeout(timer);gate.cancel();};
 },[key,loader,delay]);
 return {data:result?.key===key?result.data:undefined,error:result?.key===key?result.error:undefined,loading:result?.key!==key};
}
