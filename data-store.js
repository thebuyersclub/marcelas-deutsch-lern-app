/* Getrennte Lerninhalte, Ergänzungen und persönlicher Fortschritt. */
(function () {
  'use strict';
  const config=window.MARCELA_CONFIG;
  const root='projects/'+config.firebaseProjectId+'/databases/(default)/documents';
  const base='https://firestore.googleapis.com/v1/'+root;
  let baseVersion=null, baseSignature=null, progressSignature=null, saving=Promise.resolve();
  let pollStarted=false, dirty=false, conflicted=false;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const user=()=>window.marcelaAuth.user();
  const pendingKey=()=>LS_KEY+'_pending';
  const statusId='marcela-save-status';
  function status(message,error=false) {
    let box=document.getElementById(statusId);
    if(!box){box=document.createElement('div');box.id=statusId;box.setAttribute('role','status');
      box.style.cssText='position:fixed;bottom:calc(env(safe-area-inset-bottom,0px) + 10px);left:12px;right:12px;z-index:20000;background:white;border-radius:12px;padding:10px 14px;box-shadow:0 2px 14px #0002;font:700 14px Nunito,system-ui';document.body.append(box);}
    box.textContent=message;box.style.color=error?'#b42318':'#176b3a';
  }
  async function request(path,options={},missingAllowed=false) {
    if(!window.marcelaTestEnvironment.ready() || !user()?.verified) throw new Error('Bitte zuerst mit bestätigtem Konto anmelden.');
    const response=await fetch(base+path,{...options,headers:{'Content-Type':'application/json',...await window.marcelaAuth.headers(),...options.headers},signal:AbortSignal.timeout(15000)});
    if(missingAllowed&&response.status===404)return null;
    const result=await response.json();
    if(!response.ok){
      const conflict=response.status===409||result.error?.status==='FAILED_PRECONDITION';
      const error=new Error(conflict?'Die Inhalte wurden inzwischen auf einem anderen Gerät geändert. Deine Änderungen bleiben lokal erhalten.':'Cloud-Zugriff fehlgeschlagen. Bitte Verbindung und Kontorechte prüfen.');
      if(conflict)error.code='CONFLICT';throw error;
    }
    return result;
  }
  function progressOf(data){return {stats:data.stats||{},streak:data.streak||0,weak:data.weak||{},examRecords:data.examRecords||{},legacyImported:data.legacyImported===true};}
  function baseChapters(data){return (data.chapters||[]).filter(ch=>!ch._dictionaryAdditions);}
  async function getBase() {
    const doc=await request('/app/data',{},true);
    return {doc,chapters:doc?JSON.parse(doc.fields?.chapters?.stringValue||'[]'):[]};
  }
  async function listAdditions() {
    const docs=[];let pageToken='';
    do {
      const page=await request('/dictionaryAdditions?pageSize=100'+(pageToken?'&pageToken='+encodeURIComponent(pageToken):''));
      docs.push(...(page.documents||[]));pageToken=page.nextPageToken||'';
    } while(pageToken);
    return docs;
  }
  function withAdditions(chapters,docs){
    if(!docs.length)return chapters;
    const ch={id:'dictionary-additions',name:'Eigene Wörter und Sätze',desc:'Ergänzungen zum Lernen',_dictionaryAdditions:true,vocab:[],sentences:[],grammar:[],lessons:[]};
    for(const doc of docs){
      const f=doc.fields||{},type=f.type?.stringValue;
      if(!['vocab','sentence'].includes(type))continue;
      const item={id:doc.name.split('/').pop(),de:f.de?.stringValue||'',cz:f.cz?.stringValue||'',example:f.example?.stringValue||'',lessonName:'Eigene Ergänzungen'};
      ch[type==='vocab'?'vocab':'sentences'].push(item);
    }
    return [...chapters,ch];
  }
  async function load() {
    const [remote,progress,additions]=await Promise.all([getBase(),request('/progress/'+encodeURIComponent(user().uid),{},true),listAdditions()]);
    baseVersion=remote.doc?.updateTime||null;baseSignature=JSON.stringify(remote.chapters);
    let personal=progress?JSON.parse(progress.fields?.data?.stringValue||'{}'):{};
    progressSignature=JSON.stringify(progressOf(personal));
    let importLegacy=false;
    if(user().role==='learner'&&!personal.legacyImported){
      const archive=await request('/app/stats',{},true);
      if(archive){
        const historical=JSON.parse(archive.fields?.stats?.stringValue||'{}');
        personal.stats={...(personal.stats||{})};
        for(const [date,seconds] of Object.entries(historical)){
          if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(seconds)&&seconds>=0)
            personal.stats[date]=Math.max(personal.stats[date]||0,seconds);
        }
        personal.legacyImported=true;importLegacy=true;
      }
    }
    let chapters=remote.chapters;
    const pending=JSON.parse(localStorage.getItem(pendingKey())||'null');
    if(pending){
      // Lokale Änderungen behalten. Ein Konflikt wird niemals automatisch überschrieben.
      personal=pending.progress;
      if(user().role==='admin')chapters=pending.chapters;
      dirty=true;conflicted=user().role==='admin'&&pending.baseVersion!==baseVersion&&JSON.stringify(pending.chapters)!==baseSignature;
      status(conflicted?'Lokale Änderungen und Cloud-Stand unterscheiden sich. Bitte vor weiteren Änderungen abgleichen.':'Es gibt noch nicht übertragene Änderungen auf diesem Gerät.',true);
    }
    _cache={...progressOf(personal),chapters:withAdditions(chapters,additions)};
    if(typeof window.normalizeAppDataSeniorQA==='function')window.normalizeAppDataSeniorQA();
    localStorage.setItem(LS_KEY,JSON.stringify(_cache));
    if(!pending){status('Mit der Datenbank verbunden.');if(importLegacy)await save(_cache);}
  }
  async function persistSnapshot(snapshot){
    const sig=JSON.stringify(snapshot.chapters),psig=JSON.stringify(snapshot.progress);
    // Ohne Adminrolle gibt es keinen Schreibaufruf auf gemeinsame Inhalte.
    if(user().role==='admin'&&sig!==baseSignature){
      const condition=baseVersion?'currentDocument.updateTime='+encodeURIComponent(baseVersion):'currentDocument.exists=false';
      const result=await request('/app/data?'+condition,{method:'PATCH',body:JSON.stringify({fields:{chapters:{stringValue:sig}}})});
      baseVersion=result.updateTime;baseSignature=sig;
    }
    if(psig!==progressSignature){
      await request('/progress/'+encodeURIComponent(user().uid),{method:'PATCH',body:JSON.stringify({fields:{data:{stringValue:psig}}})});
      progressSignature=psig;
    }
  }
  function save(data){
    const previous=JSON.parse(localStorage.getItem(pendingKey())||'null');
    const snapshot={chapters:clone(baseChapters(data)),progress:clone(progressOf(data)),baseVersion:conflicted&&previous?previous.baseVersion:baseVersion};
    try{localStorage.setItem(LS_KEY,JSON.stringify(data));localStorage.setItem(pendingKey(),JSON.stringify(snapshot));}
    catch(_){status('Der Browserspeicher ist voll oder nicht verfügbar. Bitte Änderungen sichern.',true);return Promise.resolve(false);}
    dirty=true;
    if(conflicted){status('Die lokalen Änderungen stehen im Konflikt mit der Cloud. Sie bleiben auf diesem Gerät gespeichert; es wird nichts überschrieben.',true);return Promise.resolve(false);}
    saving=saving.then(async()=>{
      if(conflicted)return false;
      try{
        const stored=JSON.parse(localStorage.getItem(pendingKey())||'null');
        // Bei einem Konflikt aus einer vorherigen Sitzung niemals auf neuer Basis überschreiben.
        if(stored&&stored.baseVersion!==snapshot.baseVersion)throw new Error('Lokale Änderungen müssen mit dem Cloud-Stand abgeglichen werden.');
        await persistSnapshot(snapshot);
        if(localStorage.getItem(pendingKey())===JSON.stringify(snapshot)){localStorage.removeItem(pendingKey());dirty=false;status('Änderungen online gespeichert.');}
        return true;
      }catch(error){if(error.code==='CONFLICT')conflicted=true;status(error.message,true);return false;}
    });
    return saving;
  }
  async function retryPending(){
    await saving;
    const pending=JSON.parse(localStorage.getItem(pendingKey())||'null');
    if(!pending){status('Alle Änderungen sind gespeichert.');return true;}
    const remote=await getBase(),sig=JSON.stringify(remote.chapters);
    if(user().role==='admin'&&((conflicted&&sig!==JSON.stringify(pending.chapters))||(sig!==baseSignature&&sig!==JSON.stringify(pending.chapters)))){
      conflicted=true;status('Die Datenbank wurde auf einem anderen Gerät geändert. Bitte lokale Änderungen sichern und die Administration verständigen.',true);return false;
    }
    baseVersion=remote.doc?.updateTime||null;baseSignature=sig;conflicted=false;
    return save(_cache);
  }
  function localBackup(){return {savedAt:new Date().toISOString(),projectId:config.firebaseProjectId,data:clone(_cache),pending:JSON.parse(localStorage.getItem(pendingKey())||'null')};}
  async function addEntry(type,de,cz,example=''){
    de=de.trim();cz=cz.trim();example=example.trim();
    if(!['vocab','sentence'].includes(type)||!de||!cz||de.length>2000||cz.length>2000||example.length>4000)throw new Error('Bitte gültige deutsche und tschechische Texte eingeben.');
    const id=crypto.randomUUID();
    await request(':commit',{method:'POST',body:JSON.stringify({writes:[{
      update:{name:root+'/dictionaryAdditions/'+id,fields:{type:{stringValue:type},de:{stringValue:de},cz:{stringValue:cz},example:{stringValue:example},createdBy:{stringValue:user().uid}}},
      currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]
    }]})});
    const additions=await listAdditions();_cache.chapters=withAdditions(baseChapters(_cache),additions);
    localStorage.setItem(LS_KEY,JSON.stringify(_cache));
    return id;
  }
  function chaptersFromBackup(input){
    const doc=(input.documents||[]).find(d=>d.name?.endsWith('/app/data'));
    const chapters=doc?JSON.parse(doc.fields?.chapters?.stringValue||'null'):null;
    if(!Array.isArray(chapters)||!chapters.length)throw new Error('Diese Datei enthält keine Kapitel-Sicherung.');
    const ids=new Set();
    for(const ch of chapters){
      if(!ch||typeof ch.id!=='string'||typeof ch.name!=='string'||ids.has(ch.id))throw new Error('Ungültige oder doppelte Kapitelkennung.');
      ids.add(ch.id);
      for(const key of ['vocab','sentences','grammar','lessons'])if(ch[key]!==undefined&&!Array.isArray(ch[key]))throw new Error('Ungültiger Kapitelinhalt.');
    }
    return chapters;
  }
  async function importBackup(input){
    if(user()?.role!=='admin')throw new Error('Nur für die Administration verfügbar.');
    const chapters=chaptersFromBackup(input);
    if((await getBase()).doc)throw new Error('Es sind bereits Inhalte vorhanden. Der Import überschreibt keine Daten.');
    await request('/app/data?currentDocument.exists=false',{method:'PATCH',body:JSON.stringify({fields:{chapters:{stringValue:JSON.stringify(chapters)}}})});
    const check=await getBase();
    if(JSON.stringify(check.chapters)!==JSON.stringify(chapters))throw new Error('Die Kontrolle der übertragenen Inhalte ist fehlgeschlagen.');
    await load();window.renderAdminList();
    return chapters;
  }
  async function appendChapterPackage(input){
    if(user()?.role!=='admin')throw new Error('Nur für die Administration verfügbar.');
    if(dirty)throw new Error('Bitte zuerst offene Änderungen speichern oder sichern.');
    if(input?.format!=='marcela-chapter-package-v1'||!Array.isArray(input.chapters)||!input.chapters.length)throw new Error('Ungültiges Kapitelpaket.');
    const incoming=clone(input.chapters),ids=new Set();
    for(const ch of incoming){
      if(!ch||!/^[-a-z0-9]+$/.test(ch.id)||ids.has(ch.id)||typeof ch.name!=='string'||!ch.name.trim())throw new Error('Ungültige oder doppelte Kapitelkennung.');
      ids.add(ch.id);
      if(!ch.specialGroup||!/^[-a-z0-9]+$/.test(ch.specialGroup.id)||typeof ch.specialGroup.nameDe!=='string'||typeof ch.specialGroup.nameCz!=='string')throw new Error('Sonderkapitel-Bezeichnung fehlt.');
      for(const key of ['vocab','sentences','grammar','lessons'])if(!Array.isArray(ch[key]))throw new Error('Ungültiger Kapitelinhalt.');
    }
    const current=await getBase();
    if(!current.doc)throw new Error('Die vorhandene Datenbank konnte nicht geladen werden.');
    const existing=new Map(current.chapters.map(ch=>[ch.id,ch]));
    for(const ch of incoming){
      if(existing.has(ch.id)&&JSON.stringify(existing.get(ch.id))!==JSON.stringify(ch))throw new Error('Ein Kapitel mit dieser Kennung existiert bereits mit anderem Inhalt. Es wird nichts überschrieben.');
    }
    const additions=incoming.filter(ch=>!existing.has(ch.id));
    if(!additions.length){status('Dieses Sonderkapitel ist bereits vollständig vorhanden.');return 0;}
    const merged=[...current.chapters,...additions];
    await request('/app/data?currentDocument.updateTime='+encodeURIComponent(current.doc.updateTime),{method:'PATCH',body:JSON.stringify({fields:{chapters:{stringValue:JSON.stringify(merged)}}})});
    const check=await getBase();
    if(JSON.stringify(check.chapters)!==JSON.stringify(merged))throw new Error('Die Kontrolle nach dem Import ist fehlgeschlagen. Bitte Lerninhalte sichern und prüfen.');
    await load();window.renderAdminList();
    status('Sonderkapitel gespeichert und geprüft: '+additions.length+' neue Unterkapitel.');
    return additions.length;
  }
  async function verifyAndArchive(input){
    if(user()?.role!=='admin')throw new Error('Nur für die Administration verfügbar.');
    const original=chaptersFromBackup(input),current=await getBase();
    if(JSON.stringify(original)!==JSON.stringify(current.chapters))throw new Error('Die Kapitel unterscheiden sich. Es wurde nichts übertragen; bitte zuerst abgleichen.');
    const stats=(input.documents||[]).find(d=>d.name?.endsWith('/app/stats'));
    const stable=value=>JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))));
    if(stats){
      const existing=await request('/app/stats',{},true);
      if(existing&&stable(existing.fields)!==stable(stats.fields))throw new Error('Es existiert bereits ein anderer historischer Lernstand. Es wird nichts überschrieben.');
      if(!existing)await request('/app/stats?currentDocument.exists=false',{method:'PATCH',body:JSON.stringify({fields:stats.fields})});
      const check=await request('/app/stats');
      if(stable(check.fields)!==stable(stats.fields))throw new Error('Kontrolle des historischen Lernstands fehlgeschlagen.');
    }
    status('Alle Kapitel stimmen mit der Sicherung überein. Historischer Lernstand ist gesichert.');
    return true;
  }
  async function exportContent(){
    if(user()?.role!=='admin')throw new Error('Nur für die Administration verfügbar.');
    const [shared,additions,stats]=await Promise.all([getBase(),listAdditions(),request('/app/stats',{},true)]);
    return {exportedAt:new Date().toISOString(),projectId:config.firebaseProjectId,
      documents:[shared.doc,stats,...additions].filter(Boolean)};
  }
  function poll(){
    if(pollStarted)return;pollStarted=true;
    setInterval(async()=>{
      if(dirty||!user()?.verified)return;
      try{
        const [remote,additions]=await Promise.all([getBase(),listAdditions()]);
        if(dirty)return;
        baseVersion=remote.doc?.updateTime||null;baseSignature=JSON.stringify(remote.chapters);
        _cache.chapters=withAdditions(remote.chapters,additions);
        localStorage.setItem(LS_KEY,JSON.stringify(_cache));
        const view=document.querySelector('.view.active')?.id;
        if(view==='home')window.renderAdminList();
        if(view==='learn-home')window.renderLearnList();
      }catch(_){status('Cloud derzeit nicht erreichbar. Die geladenen Inhalte bleiben nutzbar.',true);}
    },30000);
  }
  window.marcelaData=Object.freeze({load,save,retryPending,localBackup,addEntry,importBackup,appendChapterPackage,verifyAndArchive,exportContent,chaptersFromBackup,status});
  window.loadData=load;
  window.cloudLoad=load;
  window.cloudSave=save;
  window.save=function(data){_cache=data;return save(data);};
  window.startLiveSync=poll;
})();
