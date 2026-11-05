/* REST-Transport; die bewährte Lernstand-Zusammenführung bleibt unverändert. */
(function(){
 'use strict';
 const config=window.MARCELA_CONFIG, model=window.marcelaContent;
 const conflict=()=>Object.assign(new Error('Die Daten wurden inzwischen geändert. Deine Änderungen bleiben lokal erhalten.'),{code:'CONFLICT'});
 async function rest(path,options={}){
   if(!window.marcelaAuth.user()?.verified)throw new Error('Bitte zuerst anmelden.');
   const r=await fetch(config.supabaseUrl+'/rest/v1/'+path,{...options,headers:{apikey:config.supabasePublishableKey,'Content-Type':'application/json',...await window.marcelaAuth.headers(),...options.headers},signal:AbortSignal.timeout(20000)});
   const d=r.status===204?null:await r.json();
   if(!r.ok){if(r.status===409||d?.code==='40001')throw conflict();throw new Error('Datenbankzugriff fehlgeschlagen. Bitte Verbindung und Kontorechte prüfen.');}
   return d;
 }
 const rpc=(name,body)=>rest('rpc/'+name,{method:'POST',body:JSON.stringify(body||{})});
 function doc(chapters,version){return {name:'supabase/'+config.supabaseProjectId+'/documents/app/data',updateTime:version,fields:{chapters:{stringValue:JSON.stringify(chapters)}}};}
 async function versionFor(db){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(model.canonical(db)));return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');}
 async function shared(){
   const result=await rpc('app_content_state'),db=result.tables,version=await versionFor(db);
   return doc(model.chapters(db),version);
 }
 async function request(path,options={},missingAllowed=false){
   if(path.startsWith('/app/data')){if(options.method)throw new Error('Gemeinsame Lerninhalte werden ausschließlich in Google Sheets bearbeitet.');return shared();}
   if(path.startsWith('/app/stats')){if(options.method)throw new Error('Historische Lernzeiten werden nur einmalig übertragen.');return null;}
   if(path.startsWith('/progress/')){
     const uid=decodeURIComponent(path.split('/')[2].split('?')[0]);
     if(uid!==window.marcelaAuth.user().uid)throw new Error('Fremder Lernstand ist gesperrt.');
     if(options.method==='PATCH'){
       const condition=new URLSearchParams(path.split('?')[1]),revision=Number(condition.get('currentDocument.updateTime')||0);
       const body={user_id:uid,data:JSON.parse(JSON.parse(options.body).fields.data.stringValue),revision:revision+1};
       const creating=condition.get('currentDocument.exists')==='false';
       const rows=await rest('learning_progress'+(creating?'':'?user_id=eq.'+encodeURIComponent(uid)+'&revision=eq.'+revision),{method:creating?'POST':'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(body)});
       if(!rows?.length)throw conflict();return {updateTime:String(rows[0].revision),fields:{data:{stringValue:JSON.stringify(rows[0].data)}}};
     }
     const rows=await rest('learning_progress?select=data,revision&user_id=eq.'+encodeURIComponent(uid));
     return rows.length?{updateTime:String(rows[0].revision),fields:{data:{stringValue:JSON.stringify(rows[0].data)}}}:null;
   }
   if(path.startsWith('/dictionaryAdditions')){
     const rows=[];for(let offset=0;;offset+=500){const page=await rest('dictionary_additions?select=*&order=id&limit=500&offset='+offset);rows.push(...page);if(page.length<500)break;}
     return {documents:rows.map(r=>({name:'supabase/'+config.supabaseProjectId+'/documents/dictionaryAdditions/'+r.id,fields:{type:{stringValue:r.kind},de:{stringValue:r.german},cz:{stringValue:r.czech},example:{stringValue:r.example},createdBy:{stringValue:r.created_by},createdAt:{timestampValue:r.created_at}}}))};
   }
   if(path===':commit'){
     const writes=JSON.parse(options.body).writes;if(writes.length!==1)throw new Error('Ungültiger Eintrag.');const w=writes[0],f=w.update.fields;
     await rest('dictionary_additions',{method:'POST',body:JSON.stringify({id:w.update.name.split('/').pop(),kind:f.type.stringValue,german:f.de.stringValue,czech:f.cz.stringValue,example:f.example.stringValue,created_by:window.marcelaAuth.user().uid,extra:{}})});return {};
   }
   throw new Error('Dieser Datenbankzugriff ist nicht vorgesehen.');
 }
 window.marcelaSupabaseTransport=Object.freeze({request});
})();
