const {withAndroidManifest,withDangerousMod}=require('expo/config-plugins');
const fs=require('node:fs');const path=require('node:path');
const exclusions=['root','file','database','sharedpref','external','device_root','device_file','device_database','device_sharedpref'].map(domain=>`<exclude domain="${domain}" path="."/>`).join('');
module.exports=config=>{
 config=withAndroidManifest(config,mod=>{const app=mod.modResults.manifest.application[0].$;app['android:allowBackup']='false';app['android:fullBackupContent']='@xml/local_backup_rules';app['android:dataExtractionRules']='@xml/local_data_extraction_rules';return mod;});
 return withDangerousMod(config,['android',async mod=>{
 const root=path.join(mod.modRequest.platformProjectRoot,'app/src');
 const xml=path.join(root,'main/res/xml');fs.mkdirSync(xml,{recursive:true});
 fs.writeFileSync(path.join(xml,'local_backup_rules.xml'),`<full-backup-content>${exclusions}</full-backup-content>`);
 fs.writeFileSync(path.join(xml,'local_data_extraction_rules.xml'),`<data-extraction-rules><cloud-backup>${exclusions}</cloud-backup><device-transfer>${exclusions}</device-transfer></data-extraction-rules>`);
 if(process.env.M07_TEST_CA==='1'){
 const ca=path.join(mod.modRequest.projectRoot,'native-artifacts/tls/ca.crt');
 const debug=path.join(root,'debug');fs.mkdirSync(path.join(debug,'res/raw'),{recursive:true});fs.mkdirSync(path.join(debug,'res/xml'),{recursive:true});
 fs.copyFileSync(ca,path.join(debug,'res/raw/m07_test_ca.crt'));
 fs.writeFileSync(path.join(debug,'res/xml/m07_network.xml'),'<network-security-config><base-config cleartextTrafficPermitted="true"><trust-anchors><certificates src="system"/></trust-anchors></base-config><domain-config><domain>localhost</domain><trust-anchors><certificates src="@raw/m07_test_ca"/></trust-anchors></domain-config></network-security-config>');
 const manifest=path.join(debug,'AndroidManifest.xml');let content=fs.readFileSync(manifest,'utf8');
 if(!content.includes('android:networkSecurityConfig=')) content=content.replace('<application ','<application android:networkSecurityConfig="@xml/m07_network" ');
 fs.writeFileSync(manifest,content);
 } else {
 const debug=path.join(root,'debug');
 for(const file of ['res/raw/m07_test_ca.crt','res/xml/m07_network.xml']) fs.rmSync(path.join(debug,file),{force:true});
 const manifest=path.join(debug,'AndroidManifest.xml');
 if(fs.existsSync(manifest)) fs.writeFileSync(manifest,fs.readFileSync(manifest,'utf8').replace('android:networkSecurityConfig="@xml/m07_network" ',''));
 }
 return mod;
 }]);
};
