/* Einmalige, kontogebundene Übernahme. Keine Passwörter werden gespeichert. */
(function(){
 'use strict';
 const c=window.MARCELA_CONFIG,legacyProject='marcela-deutsch-test',legacyKey='AIzaSyBMmpVE3H2h_LPkeanfmCqJBtDe8L2mZK4';
 const legacyIds={'ab268c88-64e1-4bd9-ad76-764445c059e1':'pNj7pvNO9GdiOKBujyKhbL4VxWK2','c67fe2c2-dfbf-461f-921f-496a52c8d465':'1MPycSV12USFHcf8amSctuCfKKY2'};
 async function ensure(password){
   const u=window.marcelaAuth.user(),h={apikey:c.supabasePublishableKey,...await window.marcelaAuth.headers(),'Content-Type':'application/json'};
   const url=c.supabaseUrl+'/rest/v1/learning_progress?user_id=eq.'+encodeURIComponent(u.uid);
   const current=await fetch(url+'&select=data,revision',{headers:h,signal:AbortSignal.timeout(15000)});
   if(!current.ok)throw new Error('Lernstand kann noch nicht geprüft werden.');
   const existing=await current.json();
   if(existing.length){if(existing[0].data?._migration?.firebaseProject!==legacyProject)throw new Error('Vorhandener Lernstand benötigt einen geprüften Abgleich.');return;}
   if(!password)throw new Error('Bitte einmal erneut anmelden, um deinen bisherigen Lernstand zu übernehmen.');
   const auth=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+legacyKey,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:u.email,password,returnSecureToken:true}),signal:AbortSignal.timeout(15000)});
   const session=await auth.json();
   if(!auth.ok||session.localId!==legacyIds[u.uid])throw new Error('Zur Lernstandübernahme wird das bisherige App-Passwort benötigt. Bitte im Feld „Bisheriges Passwort“ eingeben.');
   const base='https://firestore.googleapis.com/v1/projects/'+legacyProject+'/databases/(default)/documents';
   async function read(path){const r=await fetch(base+path,{headers:{Authorization:'Bearer '+session.idToken},signal:AbortSignal.timeout(15000)});if(r.status===404)return null;if(!r.ok)throw new Error('Bisheriger Lernstand konnte nicht gesichert werden.');return r.json();}
   const [personal,historical]=await Promise.all([read('/progress/'+session.localId),u.role==='learner'?read('/app/stats'):null]);
   const original=personal?JSON.parse(personal.fields.data.stringValue):{},data=JSON.parse(JSON.stringify(original));
   if(u.role==='learner'&&!data.legacyImported&&historical){data.stats={...(data.stats||{})};for(const [day,seconds] of Object.entries(JSON.parse(historical.fields?.stats?.stringValue||'{}')))if(/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(seconds)&&seconds>=0)data.stats[day]=Math.max(Number(data.stats[day]||0),seconds);data.legacyImported=true;}
   data._migration={firebaseProject:legacyProject,firebaseUid:session.localId,sourceUpdateTime:personal?.updateTime||null,importedAt:new Date().toISOString(),originalProgress:original,historicalStats:historical?.fields||null};
   // Noch nicht gespeicherte Änderungen im bisherigen Browser niemals still übergehen.
   const prefix='marcela_test_v1_'+legacyProject+'_'+session.localId+'_pending';
   for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(prefix)&&localStorage.getItem(k))throw new Error('In diesem Browser sind noch ungespeicherte alte Änderungen. Bitte zuerst die bisherige App öffnen und diese speichern oder sichern.');}
   const save=await fetch(c.supabaseUrl+'/rest/v1/learning_progress',{method:'POST',headers:h,body:JSON.stringify({user_id:u.uid,data,revision:1}),signal:AbortSignal.timeout(15000)});
   if(!save.ok&&save.status!==409)throw new Error('Lernstandübernahme fehlgeschlagen. Originaldaten bleiben erhalten.');
   const check=await fetch(url+'&select=data',{headers:h,signal:AbortSignal.timeout(15000)});const rows=await check.json();
   if(!check.ok||rows.length!==1||window.marcelaContent.canonical(rows[0].data)!==window.marcelaContent.canonical(data))throw new Error('Lernstandübernahme konnte nicht vollständig bestätigt werden. Bitte Administration verständigen.');
 }
 window.marcelaLegacyMigration=Object.freeze({ensure});
})();
