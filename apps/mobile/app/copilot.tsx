import { StyleSheet, Text, View } from 'react-native';
export default function Screen() {
  return <View style={styles.page}><Text accessibilityRole="header" style={styles.title}>Copilot</Text>
    <Text style={styles.detail}>开发中 · 原生安全预检尚未完成</Text></View>;
}
const styles = StyleSheet.create({page:{flex:1,padding:24,gap:16,backgroundColor:'#f5f5f2'},title:{fontSize:28,color:'#172621'},detail:{fontSize:16,lineHeight:24,color:'#4d6259'}});
