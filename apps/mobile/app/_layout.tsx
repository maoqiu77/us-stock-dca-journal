import { useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Holdings from './index';
import Records from './records';
import Copilot from './copilot';
const tabs = ['持仓','记录','Copilot'] as const;
export default function Layout() {
  const [selected,setSelected] = useState(0);
  return <SafeAreaProvider><SafeAreaView style={styles.page}>
    {selected===0?<Holdings/>:selected===1?<Records/>:<Copilot/>}
    <View accessibilityRole="tablist" style={styles.tabs}>{tabs.map((title,index)=><Pressable
      key={title} accessibilityRole="tab" accessibilityState={{selected:selected===index}}
      onPress={()=>setSelected(index)} style={styles.tab}>
      <Text style={[styles.label,selected===index&&styles.active]}>{title}</Text>
    </Pressable>)}</View>
  </SafeAreaView></SafeAreaProvider>;
}
const styles=StyleSheet.create({page:{flex:1,backgroundColor:'#f5f5f2'},tabs:{flexDirection:'row',gap:8,borderTopWidth:1,borderTopColor:'#ced9d3'},tab:{flex:1,minHeight:52,alignItems:'center',justifyContent:'center'},label:{fontSize:16,color:'#4d6259'},active:{color:'#164e37',fontWeight:'700'}});
