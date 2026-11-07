/* Persönlicher Unterricht: Antworten werden ausschließlich am Server bewertet. */
(function(){'use strict';
 let view=null,owner=null,busy=false,generation=0,controller=null,audio=null,audioURL=null,speechGeneration=0,speechEnd=null,tick=null,lastTick=0,checkingState=false;
 let pendingAudio=false,pronunciationClip=null,pronunciationMessage='';
 let examResults=[],resultsOwner=null,resultsRequest=null,examResult=null,examAnswer='',recording=null,recorded=null;
 const skillLabels={reading:'Lesen',listening:'Hören',writing:'Schreiben',speaking:'Sprechen'};
 const retention=48*3600000;
 let history=[],translations=[],translating=false,translationBusy=false,translationDraft='',draft='',selected=[],menuOpen=false,chatTimer=null;
 const user=()=>window.marcelaAuth.user(),active=()=>document.getElementById('teacher-view')?.classList.contains('active');
 const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
 function button(label,action,secondary=false){const el=node('button',label,secondary?'teacher-button secondary':'teacher-button');el.type='button';el.disabled=busy;el.onclick=action;return el;}
 function stopSpeech(){speechGeneration++;if(speechEnd){speechEnd();speechEnd=null;}if(audio){audio.pause();audio=null;}if(audioURL){URL.revokeObjectURL(audioURL);audioURL=null;}}
 function clock(){const at=Date.now();if(lastTick&&user()?.uid===owner&&active()&&!document.hidden&&view?.status==='active'&&!view.exam&&!examResult){const delta=Math.min(5,Math.floor((at-lastTick)/1000));if(delta>0)window.addSecs?.(delta);}lastTick=at;}
 function stopClock(){if(tick){clock();clearInterval(tick);tick=null;}lastTick=0;}
 function syncClock(){if(active()&&!document.hidden&&view?.status==='active'&&!view.exam&&!examResult){if(!tick){lastTick=Date.now();tick=setInterval(clock,4000);}}else stopClock();}
 function content(){return document.getElementById('teacher-content');}
 function message(text){const el=document.getElementById('teacher-status');if(el)el.textContent=text;}
 function setBusy(value){busy=value;document.querySelectorAll('#teacher-view button').forEach(el=>el.disabled=value);content()?.setAttribute('aria-busy',String(value));}
 async function request(operation,event,messages,examFields){
  if(user()?.uid!==owner)throw Error('Bitte erneut anmelden.');
  const seq=generation,body={operation,chat:true,requestId:crypto.randomUUID()};
  if(['event','review','restart','next','exam_start','exam_audio','exam_answer','exam_cancel','exam_pronunciation'].includes(operation))body.revision=view.revision;
  if(event)body.event={...event,stepId:view.stepId};
  if(messages)body.messages=messages;
  if(examFields)Object.assign(body,examFields);
  const requestController=new AbortController();
  if(operation!=='state')controller=requestController;
  const timeout=setTimeout(()=>requestController.abort(),operation==='state'?10000:55000);
  try{
   const response=await fetch(window.MARCELA_CONFIG.teacherEndpoint,{method:'POST',headers:{...await window.marcelaAuth.headers(),'Content-Type':'application/json'},body:JSON.stringify(body),signal:requestController.signal,cache:'no-store'});
   const result=await response.json();if(seq!==generation||user()?.uid!==owner)throw Error('Unterricht wurde geschlossen.');
   if(!response.ok)throw Error(result.error?.message||'Unterricht ist gerade nicht erreichbar.');return result;
  }finally{clearTimeout(timeout);if(controller===requestController)controller=null;}
 }
 async function send(operation,event,outgoing){
  if(busy)return;stopSpeech();setBusy(true);message('Einen Moment …');
  try{
   const result=await request(operation,event);
   mergeRemoteHistory(result);
   if(outgoing)remember({id:result.sessionId+':answer:'+result.revision,side:'right',de:outgoing});
   if(result.feedback)remember({id:result.sessionId+':feedback:'+result.revision,side:'left',...result.feedback});
   rememberChapterFarewell(result);
   if(outgoing||result.stepId!==view?.stepId){draft='';selected=[];}
   view=result;menuOpen=false;render();
  }
  catch(error){if(active()){message(error.name==='AbortError'?'Die Verbindung hat zu lange gedauert. Bitte den gespeicherten Stand neu laden.':error.message);const retry=button('Gespeicherten Stand laden',()=>load());retry.disabled=false;document.getElementById('teacher-retry').replaceChildren(retry);}}
  finally{setBusy(false);syncClock();}
 }
 function storeExamResults(result,uid){
  if(!Array.isArray(result)||user()?.uid!==uid)return;
  resultsOwner=uid;
  examResults=result;
  window.renderLastGlobalExamOnSplash?.();
 }
 function resultsForHome(studyRecords=[]){
  const records=[...(resultsOwner&&resultsOwner===user()?.uid?examResults:[]),...studyRecords].filter(Boolean);
  return [...new Map(records.map(result=>[result.id||JSON.stringify(result),result])).values()]
   .sort((a,b)=>(b.ts||0)-(a.ts||0));
 }
 async function refreshExamResults(){
  const uid=user()?.uid;
  if(!uid||!user()?.verified||resultsRequest===uid)return;
  resultsRequest=uid;
  try{
   const response=await fetch(window.MARCELA_CONFIG.teacherEndpoint,{method:'POST',
    headers:{...await window.marcelaAuth.headers(),'Content-Type':'application/json'},
    body:JSON.stringify({operation:'exam_results'}),signal:AbortSignal.timeout(10000),cache:'no-store'});
   if(response.ok)storeExamResults((await response.json()).results,uid);
  }catch{}finally{if(resultsRequest===uid)resultsRequest=null;}
 }
 function resultDetails(result){
  const list=node('ul');
  for(const [skill,score] of Object.entries(result.modules||{}))list.append(node('li',skillLabels[skill]+' '+score+' %'));
  return list;
 }
 function openResults(studyRecords){
  const dialog=node('dialog',undefined,'foxly-exam-history');
  dialog.append(node('h2','Letzte Prüfungen'));
  for(const result of resultsForHome(studyRecords)){
   const item=node('section');
   item.append(node('h3',(result.type||'Prüfung')+' · '+result.score+'/'+result.total),
    node('p',result.chapterName+(result.ts?' · '+new Date(result.ts).toLocaleString('de-AT'):'') ));
   if(result.modules)item.append(resultDetails(result));
   dialog.append(item);
  }
  const close=button('Schließen',()=>dialog.close(),true);dialog.append(close);
  dialog.onclose=()=>dialog.remove();
  document.body.append(dialog);dialog.showModal();
 }
 function clearRecording(){
  if(recording)recording.stop();
  recorded=null;
 }
 async function recordExamTurn(exam){
  if(recording||busy)return;
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){
   message('Für den Sprechteil brauchst du einen Browser mit Mikrofonaufnahme.');return;
  }
  let stream;
  setBusy(true);
  try{
   stream=await navigator.mediaDevices.getUserMedia({audio:true});
   if(!active()||view.exam!==exam||user()?.uid!==owner){stream.getTracks().forEach(track=>track.stop());return;}
   const recorder=new MediaRecorder(stream,{audioBitsPerSecond:48000});
   const chunks=[];
   recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
   recorder.onstop=()=>{
    stream.getTracks().forEach(track=>track.stop());
    if(recording?.recorder===recorder)recording=null;
    if(!active()||view.exam!==exam||user()?.uid!==owner)return;
    recorded=new Blob(chunks,{type:recorder.mimeType||chunks[0]?.type});
    render();
   };
   recorder.onerror=()=>{
    stop();message('Die Aufnahme konnte nicht erstellt werden.');
   };
   const stop=()=>{
    clearTimeout(timer);
    if(recorder.state!=='inactive')recorder.stop();
    stream.getTracks().forEach(track=>track.stop());
   };
   const timer=setTimeout(stop,20000);
   recording={recorder,stop};
   try{recorder.start();}catch(error){stop();recording=null;throw error;}
  }catch{
   stream?.getTracks().forEach(track=>track.stop());
   message('Mikrofon nicht verfügbar. Prüfe die Freigabe im Browser.');
  }finally{
   setBusy(false);
   if(recording)render();
  }
 }
 async function submitRecording(){
  if(!recorded||busy)return;
  const blob=recorded;
  if(blob.size>500000){message('Die Aufnahme ist zu groß. Bitte nimm eine kürzere Antwort auf.');return;}
  const data=await blob.arrayBuffer();
  return examRequest('exam_answer',{audio:audioBase64(data),format:blob.type.split(';')[0]});
 }
 function audioBase64(buffer){
  const data=new Uint8Array(buffer);
  let binary='';
  for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192));
  return btoa(binary);
 }
 async function pronunciationWav(blob){
  const decoder=new OfflineAudioContext(1,1,16000);
  const decoded=await decoder.decodeAudioData(await blob.arrayBuffer());
  const samples=decoded.getChannelData(0).subarray(0,192000);
  const data=new ArrayBuffer(44+samples.length*2);
  const wav=new DataView(data);
  for(const [offset,label] of [[0,'RIFF'],[8,'WAVEfmt '],[36,'data']])
   for(let i=0;i<label.length;i++)wav.setUint8(offset+i,label.charCodeAt(i));
  for(const [offset,value] of [[4,data.byteLength-8],[16,16],[24,16000],[28,32000],[40,samples.length*2]])
   wav.setUint32(offset,value,true);
  for(const [offset,value] of [[20,1],[22,1],[32,2],[34,16]])wav.setUint16(offset,value,true);
  samples.forEach((value,i)=>wav.setInt16(44+i*2,Math.max(-32768,Math.min(32767,value*32768)),true));
  return audioBase64(data);
 }
 async function requestPronunciation(){
  if(busy||!pronunciationClip||!examResult)return;
  const result=examResult,clip=pronunciationClip;
  setBusy(true);message('Chvilku prosím…');
  try{
   const audio=await pronunciationWav(clip);
   if(!active()||examResult!==result||user()?.uid!==owner)return;
   const response=await request('exam_pronunciation',null,null,{examId:result.id,audio});
   view={...view,revision:response.revision};
   pronunciationMessage=response.tip||'Z téhle nahrávky nedokážu dát spolehlivý tip k výslovnosti.';
  }catch{
   pronunciationMessage='Tip k výslovnosti teď není k dispozici.';
  }finally{
   if(examResult===result){
    pronunciationClip=null;
    render();
   }
   setBusy(false);
  }
 }
 async function examRequest(operation,fields={}){
  if(busy||recording)return;
  const current=view.exam;
  if(current)Object.assign(fields,{examIndex:current.index,examTurn:current.turn});
  pendingAudio=false;stopSpeech();setBusy(true);message('Einen Moment …');
  try{
   const result=await request(operation,null,null,fields);
   if(operation==='exam_audio'){
    view={...view,revision:result.revision,exam:result.exam};
    audioURL=URL.createObjectURL(new Blob([Uint8Array.from(atob(result.audio),char=>char.charCodeAt(0))],{type:'audio/mpeg'}));
    audio=new Audio(audioURL);
    await audio.play().catch(()=>{pendingAudio=true;});
   }else{
    if(current&&!result.exam&&operation==='exam_answer'){
     examResult=result.examResults.find(item=>item.id===current.id);
     pronunciationClip=current.skill==='speaking'&&typeof OfflineAudioContext!=='undefined'?recorded:null;
     pronunciationMessage='';
    }
    view=result;examAnswer='';recorded=null;
    storeExamResults(result.examResults,owner);
   }
   render();syncClock();
  }catch(error){message(error.name==='AbortError'?'Die Anfrage hat zu lange gedauert. Bitte lade den gespeicherten Stand.':error.message);
   if(operation!=='exam_start')document.getElementById('teacher-retry').replaceChildren(button('Stand neu laden',load,true));
  }finally{setBusy(false);}
 }
 function renderExam(box,composer){
  const exam=view.exam;
  if(!exam){
   box.append(node('h2',examResult.type),node('p',examResult.chapterName+' · '+examResult.score+' %'),resultDetails(examResult));
   if(pronunciationMessage)box.append(node('p',pronunciationMessage));
   if(pronunciationClip){
    composer.append(node('p','Volitelné: krátkou část nahrávky vyhodnotí OpenAI. Výsledek zkoušky se tím nemění.'),
     button('Tip k výslovnosti',requestPronunciation,true));
   }
   composer.append(button('Zurück zum Kurs',()=>{
    examResult=null;pronunciationClip=null;pronunciationMessage='';render();syncClock();
   }));
   return;
  }
  box.append(node('h2',skillLabels[exam.skill]+' · '+(exam.index+1)+'/'+exam.total));
  if(exam.text)box.append(node('p',exam.text,'foxly-exam-text'));
  if(exam.turnCount)box.append(node('p','Gesprächszug '+(exam.turn+1)+' von '+exam.turnCount));
  box.append(node('p',exam.prompt,'foxly-exam-text'));
  if(exam.skill==='listening'){
   if(pendingAudio)box.append(button('Geladenen Hörtext anhören',async()=>{
    try{await audio.play();pendingAudio=false;render();}
    catch{message('Der Hörtext konnte nicht abgespielt werden.');}
   },true));
   else if(exam.playsLeft)box.append(button('Hörtext abspielen ('+exam.playsLeft+')',()=>examRequest('exam_audio'),true));
   else box.append(node('p','Beide Wiedergaben wurden genutzt.'));
  }
  const form=node('form',undefined,'foxly-exam-form');composer.append(form);
  const submit=node('button','Antwort abgeben','teacher-button');submit.type='submit';submit.disabled=busy;
  if(exam.options.length){
   for(const [i,option] of exam.options.entries()){
    const label=node('label'),input=node('input');input.type='radio';input.name='exam-option';input.value=i;input.required=true;
    label.append(input,node('span',option));form.append(label);
   }
   form.append(submit);
   form.onsubmit=event=>{event.preventDefault();const option=form.querySelector('input:checked');
    if(option&&(exam.skill!=='listening'||!pendingAudio&&exam.playsLeft<2))return examRequest('exam_answer',{option:Number(option.value)});
    message('Höre zuerst den Hörtext an.');
   };
  }else if(exam.skill==='writing'){
   const field=node('textarea');field.required=true;field.maxLength=1000;field.value=examAnswer;
   field.setAttribute('aria-label','Antwort auf Deutsch');field.oninput=()=>{examAnswer=field.value;};
   form.append(field,submit);form.onsubmit=event=>{event.preventDefault();return examRequest('exam_answer',{answer:field.value.trim()});};
  }else{
   form.append(node('p','Sprich bis zu 20 Sekunden. Für die Bewertung wird die Aufnahme an OpenAI übertragen.'));
   if(recording)form.append(button('Aufnahme stoppen',()=>recording?.stop()));
   else{
    form.append(button(recorded?'Neu aufnehmen':'Aufnahme starten',()=>recordExamTurn(exam)));
    if(recorded){form.append(submit);form.onsubmit=event=>{event.preventDefault();return submitRecording();};}
   }
  }
  if(!recording)composer.append(button('Prüfung abbrechen',()=>{
   if(window.confirm('Prüfung abbrechen? Dieser Versuch wird nicht gewertet.'))return examRequest('exam_cancel');
  },true));
 }
 function addExamOptions(actions){
  const options=view.examOptions;
  if(!options?.chapter&&!options?.total)return;
  const panel=node('details',undefined,'foxly-exam-options');
  if(view.feedback?.de.includes('100 % der Lernziele'))panel.open=true;
  panel.append(node('summary','Prüfung starten'),
   node('p','Mit Lesen, Hören, Schreiben und Sprechen. Halte dein Mikrofon bereit.'));
  if(options.chapter)panel.append(button('Kapitelprüfung · '+options.chapter.title,()=>examRequest('exam_start',{examKind:'chapter'})));
  if(options.total)panel.append(button('Gesamtprüfung · bisherige Kapitel',()=>examRequest('exam_start',{examKind:'total'}),true));
  actions.append(panel);
 }
 async function load(){
  if(busy)return;setBusy(true);message('Unterricht wird geladen …');
  try{
   view=await request('start');
   storeExamResults(view.examResults,owner);
   const imported=await importLocalHistory();
   rememberChapterFarewell(view);render();
   if(!imported)message('Historii se zatím nepodařilo synchronizovat.');
  }catch(error){message(error.message);const retry=button('Erneut versuchen',load);retry.disabled=false;document.getElementById('teacher-retry').replaceChildren(retry);}finally{setBusy(false);syncClock();}
 }
 async function refreshCourse(){
  if(!active()||document.hidden||!view||busy||checkingState||translating||recording||examAnswer||recorded||draft||selected.length)return;
  checkingState=true;
  const current=view;
  try{
   const latest=await request('state');
   if(!active()||document.hidden||busy||translating||draft||selected.length||view!==current||
      latest.empty||latest.revision<=current.revision)return;
   view=latest;mergeRemoteHistory(latest);storeExamResults(latest.examResults,owner);
   rememberChapterFarewell(latest);render();syncClock();
  }catch{
   // Keep the current screen on temporary connection failures.
  }finally{checkingState=false;}
 }
 async function speak(slow=false,text=view?.teacher?.de){
  stopSpeech();const seq=speechGeneration;if(!text)return;
  const ownerAtStart=owner;
  try{for await(const blob of window.marcelaTranslator.speechChunks(text)){
   if(seq!==speechGeneration||!active()||user()?.uid!==ownerAtStart)return;
   audioURL=URL.createObjectURL(blob);audio=new Audio(audioURL);audio.playbackRate=slow?0.8:1;
   await new Promise((resolve,reject)=>{speechEnd=resolve;audio.onended=resolve;audio.onerror=()=>reject(Error('Vorlesen ist gerade nicht möglich.'));audio.play().catch(reject);});
   speechEnd=null;if(audioURL){URL.revokeObjectURL(audioURL);audioURL=null;}if(seq!==speechGeneration)break;
  }}catch(error){if(seq===speechGeneration&&active())message(error.message);}
 }
 const historyKey=()=> 'marcela.foxly.history.'+owner;
 function saveHistory(){
  try{window.localStorage?.setItem(historyKey(),JSON.stringify(history));}catch{}
 }
 function pruneHistory(){
  const recent=history.filter(item=>item.at>Date.now()-retention);
  if(recent.length===history.length)return false;
  history=recent;saveHistory();return true;
 }
 function readHistory(){
  try{
   const stored=JSON.parse(window.localStorage?.getItem(historyKey())||'[]');
   history=Array.isArray(stored)?stored.filter(item=>typeof item?.de==='string'&&Number.isFinite(item.at)):[];
  }catch{history=[];}
  pruneHistory();
 }
 function mergeRemoteHistory(result){
  if(!Array.isArray(result.chatHistory))return;
  const local=new Map(history.map(item=>[item.id,item]));
  const merged=new Map();
  for(const item of result.chatHistory){
   const previous=local.get(item.id);
   const sameSource=previous&&['de','cz','prompt','correction'].every(key=>(previous[key]||'')===(item[key]||''));
   merged.set(item.id,sameSource&&previous.translated?{...item,translated:previous.translated}:item);
  }
  for(const item of history)if(!merged.has(item.id))merged.set(item.id,item);
  history=[...merged.values()].filter(item=>item.at>Date.now()-retention).sort((a,b)=>a.at-b.at);
  for(const instruction of history.filter(item=>item.id.endsWith(':instruction'))){
   const task=merged.get(instruction.id.slice(0,-12));
   if(!task||!history.includes(task))continue;
   history.splice(history.indexOf(instruction),1);
   history.splice(history.indexOf(task),0,instruction);
  }
  saveHistory();
 }
 async function importLocalHistory(){
  if(!Array.isArray(view.chatHistory))return true;
  const known=new Set(view.chatHistory.map(item=>item.id));
  const pending=history.filter(item=>!known.has(item.id));
  mergeRemoteHistory(view);
  if(!pending.length)return true;
  const encoder=new TextEncoder();
  let batch=[],bytes=0;
  try{
   for(const {translated,...item} of pending){
    const size=encoder.encode(JSON.stringify(item)).length+1;
    if(size>10000)continue;
    if(batch.length>=35||bytes+size>10000){
     view=await request('merge_chat',null,batch);mergeRemoteHistory(view);batch=[];bytes=0;
    }
    batch.push(item);bytes+=size;
   }
   if(batch.length){view=await request('merge_chat',null,batch);mergeRemoteHistory(view);}
   return true;
  }catch{return false;}
 }
 function remember(item,updateTask=false,beforeId){
  pruneHistory();
  if(!item.de)return;
  const existing=history.find(entry=>entry.id===item.id);
  if(existing){
   if(updateTask&&['de','cz','prompt','promptLang','needsTranslation'].some(key=>(existing[key]||'')!==(item[key]||''))){
    Object.assign(existing,item);delete existing.translated;saveHistory();
   }
   return;
  }
  const before=beforeId?history.findIndex(entry=>entry.id===beforeId):-1;
  const stored={...item,at:item.at??(before<0?Date.now():history[before].at)};
  if(before<0)history.push(stored);
  else history.splice(before,0,stored);
  saveHistory();
 }
 function rememberChapterFarewell(result){
  if(result.chapterFarewell?.at>Date.now()-retention)
   remember({id:result.sessionId+':chapter-farewell',side:'right',report:true,...result.chapterFarewell},true);
 }
 const localTime=at=>new Date(at).toLocaleTimeString('de-AT',{hour:'2-digit',minute:'2-digit'});
 const goodnight=text=>/^(gute nacht|dobrou noc)[.!?]*$/iu.test(text.trim());
 function currentInstruction(view){
  if(view.instruction?.de)return view.instruction;
  if(view.kind!=='free_response')return null;
  return {
   de:'Schreib deine Antwort auf Deutsch.'+(view.task?' '+view.task:''),
   cz:'Vypracuj následující úlohu německy.',
   needsTranslation:!!view.task
  };
 }
 function bubble(item){
  const outer=node('article',undefined,'foxly-bubble foxly-'+item.side);
  outer.append(node('p',item.de));
  if(item.prompt){
   const prompt=node('p',item.prompt,'foxly-prompt');
   if(item.promptLang)prompt.lang=item.promptLang;
   outer.append(prompt);
  }
  if(item.correction)outer.append(node('p',item.correction,'foxly-prompt'));
  if((item.side==='left'||item.report)&&!translating){
   const details=node('details',undefined,'foxly-translation');
   const label=node('summary','Překlad');label.lang='cs';
   const translated=node('p',item.cz||'');translated.lang='cs';
   details.append(label,translated);
   const needsTranslation=item.needsTranslation||!item.cz;
   const extra=[item.promptLang!=='cs'?item.prompt:'',item.correction].filter(Boolean).join('\n');
   const source=[needsTranslation?item.de:'',extra].filter(Boolean).join('\n');
   if(item.translated)translated.textContent=item.translated;
   let pending=false;
   function revealTranslation(){
    if(!details.open||!details.isConnected)return;
    const box=content(),visible=box.getBoundingClientRect(),opened=details.getBoundingClientRect();
    const gap=10;
    if(opened.height>visible.height-2*gap)box.scrollTop+=opened.top-visible.top-gap;
    else if(opened.bottom>visible.bottom-gap)box.scrollTop+=opened.bottom-visible.bottom+gap;
   }
   details.ontoggle=async()=>{
    if(!details.open)return;
    revealTranslation();
    if(!source||pending||item.translated)return;
    const account=owner;
    pending=true;translated.textContent=item.cz||'Překládám…';
    try{
     const result=await window.marcelaTranslator.translate(source,'de-cz');
     if(account!==owner||user()?.uid!==account)return;
     item.translated=[needsTranslation?'':item.cz,result].filter(Boolean).join('\n');
     translated.textContent=item.translated;saveHistory();
    }catch{translated.textContent=[item.cz,'Překlad se nepodařil. Zavři ho a otevři znovu.'].filter(Boolean).join('\n');}
    finally{pending=false;revealTranslation();}
   };
   outer.append(details);
  }
  outer.append(node('small',localTime(item.at),'foxly-time'));
  return outer;
 }
 function sendButton(form){
  const submit=button('↑',()=>{});submit.type='submit';
  submit.setAttribute('aria-label','Odeslat');
  form.append(submit);
 }
 function textComposer(parent,{value,onInput,onSend}){
  const form=node('form',undefined,'foxly-input-row'),answer=node('input',undefined,'foxly-text-input');
  answer.type='text';if(!translating)answer.maxLength=2000;answer.autocomplete='off';
  answer.setAttribute('enterkeyhint','send');
  answer.placeholder=translating?'Napiš německy nebo česky…':
   view?.kind==='free_response'?'Napiš odpověď německy…':'Napiš zprávu…';
  answer.setAttribute('aria-label',answer.placeholder);answer.value=value;
  answer.oninput=()=>onInput(answer.value);
  form.append(answer);sendButton(form);
  form.onsubmit=event=>{
   event.preventDefault();
   if(translating?translationBusy:busy)return;
   const text=answer.value.trim();
   if(!text){answer.focus();return;}
   answer.blur();
   return onSend(text);
  };
  parent.append(form);
 }
 function tiles(parent,items,ordered,submit){
  const form=node('form',undefined,'foxly-tiles');
  const tray=node('div',undefined,'foxly-tray'),pool=node('div',undefined,'foxly-pool');
  const row=node('div',undefined,'foxly-input-row');
  row.append(tray);sendButton(row);
  row.children[row.children.length-1].type='submit';
  form.append(pool,row);
  form.onsubmit=event=>{
   event.preventDefault();
   if(selected.length!==(ordered?items.length:1)){message(ordered?'Seřaď všechny části.':'Vyber jednu možnost.');return;}
   submit(selected.map(id=>items.find(item=>item.id===id)));
  };
  function update(){
   const chosen=selected.map(id=>items.find(item=>item.id===id)).filter(Boolean);
   tray.replaceChildren(...chosen.map((item,index)=>{
    const group=node('span',undefined,'foxly-tile');
    if(ordered&&index>0){
     const move=button('←',()=>{
      [selected[index-1],selected[index]]=[selected[index],selected[index-1]];update();
     },true);move.setAttribute('aria-label','Posunout '+item.text);group.append(move);
    }
    const remove=button(item.text+' ×',()=>{selected.splice(index,1);update();},true);
    group.append(remove);return group;
   }));
   pool.replaceChildren(...items.map(item=>{
    const b=button(item.text,()=>{
     if(ordered){if(!selected.includes(item.id))selected.push(item.id);}
     else selected=[item.id];
     update();
    },true);
    b.setAttribute('aria-pressed',String(selected.includes(item.id)));return b;
   }));
   message('');
  }
  update();parent.append(form);
 }
 async function translate(text){
  if(translationBusy)return;
  const account=owner,turn=generation;translationBusy=true;render();
  let failure='';
  try{
   const result=await window.marcelaTranslator.translate(text,'auto');
   if(account!==owner||turn!==generation||user()?.uid!==account)return;
   translations.push({de:text,side:'right',at:Date.now()},{de:result,side:'left',at:Date.now()});
   translationDraft='';
  }catch(error){failure=error.message;}
  finally{
   if(account===owner&&turn===generation&&user()?.uid===account){
    translationBusy=false;
    if(translating){
     render();if(failure)message(failure);
    }
   }
  }
 }
 function helpMenu(parent){
  const controls=node('div',undefined,'foxly-actions');
  const plus=button('+',()=>{
   menuOpen=!menuOpen;panel.hidden=!menuOpen;plus.setAttribute('aria-expanded',String(menuOpen));
  },true);
  plus.setAttribute('aria-label','Nápověda');plus.setAttribute('aria-expanded',String(menuOpen));
  const panel=node('div',undefined,'foxly-help');panel.hidden=!menuOpen;
  panel.append(button('Překlad',()=>{menuOpen=false;translating=true;stopSpeech();render();},true));
  if(view.status==='active'){
   panel.append(button('? · Co mám udělat?',()=>{
    menuOpen=false;panel.hidden=true;plus.setAttribute('aria-expanded','false');
    return send('event',{type:'help',action:'explain'});
   },true));
   panel.append(button('Přečíst nahlas',()=>speak(),true));
   for(const phrase of view.helpPhrases||[]){
    if(phrase.effect==='explain')continue;
    panel.append(button(phrase.cz||phrase.de,()=>['repeat','slower'].includes(phrase.effect)
     ?speak(phrase.effect==='slower'):send('event',{type:'help',action:phrase.effect}),true));
   }
  }
  if(view.status==='active'||view.status==='complete'&&!view.endedEarly)
   panel.append(button('Dobrou noc',()=>send('event',{type:'goodnight'},'Dobrou noc'),true));
  controls.append(plus,panel);parent.append(controls);
 }
 function refreshHeader(){
  document.getElementById('foxly-clock').textContent=localTime(Date.now());
  document.getElementById('foxly-score').textContent=translating||view?.exam||examResult?'':view?.score==null?'— %':view.score+' %';
  document.getElementById('foxly-title').textContent=view?.exam||examResult?'Foxly · Prüfung':translating?'Übersetzer / Překlad':'Foxly – Spaß beim Lernen';
 }
 function render(){
  const box=content(),composer=document.getElementById('foxly-composer');
  const focused=document.activeElement;
  const textTask=view?.status==='active'&&view.kind!=='choice'&&!view.exercise?.items?.length;
  const composerMode=view?.exam||examResult?'exam':translating?'translation':view?.kind||'';
  const keepInput=focused?.className==='foxly-text-input'&&composer.contains(focused)&&
   composer.dataset.mode===composerMode&&(translating||textTask);
  box.replaceChildren();
  if(!keepInput){
   composer.replaceChildren();
   composer.dataset.mode=composerMode;
  }
  document.getElementById('teacher-retry').replaceChildren();message('');
  refreshHeader();
  if(view?.exam||examResult){
   renderExam(box,composer);return;
  }
  if(translating){
   box.append(...translations.map(bubble));
   if(keepInput)focused.value=translationDraft;
   else textComposer(composer,{value:translationDraft,onInput:value=>{translationDraft=value;},onSend:translate});
   if(translationBusy)message('Překládám…');
  }else if(view&&!view.empty){
   if(!view.endedEarly&&view.status!=='paused'){
    const exercise=view.exercise;
    const taskId=(view.chatThreadId||view.sessionId)+':task:'+view.stepId;
    const instruction=currentInstruction(view);
    if(instruction)remember({id:taskId+':instruction',side:'left',...instruction},true,taskId);
    remember({id:taskId,side:'left',...view.teacher,
     needsTranslation:!view.stepId.startsWith('linked-practice-')||exercise?.mode==='question',
     prompt:exercise?.prompt||'',promptLang:['words','vocabulary','writing'].includes(exercise?.mode)?'cs':''},true);
   }
   box.append(...history.map(bubble));
   if(keepInput){
    focused.value=draft;
    box.scrollTop=box.scrollHeight;
    return;
   }
   const actions=node('div',undefined,'foxly-compose-main');composer.append(actions);
   addExamOptions(actions);
   if(view.status==='paused'){
    actions.append(button('Fortsetzen',()=>send('event',{type:'resume'})));
   }else if(view.status==='complete'){
    if(view.plan?.action!=='none')actions.append(button('Weiterlernen',()=>send('next')));
    else actions.append(node('p','Du hast alle verfügbaren Kapitel abgeschlossen.'));
    if(view.reviewDueAt&&Date.now()>=Date.parse(view.reviewDueAt))
     actions.append(button('Wiederholung beginnen',()=>send('review'),true));
    actions.append(button('Diese Einheit noch einmal',()=>send('restart'),true));
   }else if(view.kind==='choice'||view.exercise?.items?.length){
    const ordered=['words','sentences'].includes(view.exercise?.mode);
    const items=view.kind==='choice'?(view.options||[]).map(option=>({id:option.id,text:option.text||option.de||option.label||option.id})):view.exercise.items;
    tiles(actions,items,ordered,chosen=>{
     const event=view.kind==='choice'?{type:'choose',optionId:chosen[0].id}:{type:'practice',itemIds:chosen.map(item=>item.id)};
     send('event',event,chosen.map(item=>item.text).join(view.exercise?.mode==='sentences'?'\n':' '));
    });
   }else{
    if(view.kind==='information')actions.append(button('Weiter',()=>send('event',{type:'continue'}),true));
    textComposer(actions,{value:draft,onInput:value=>{draft=value;},onSend:answer=>{
     if(goodnight(answer)){send('event',{type:'goodnight',action:/^gute nacht/i.test(answer)?'de':'cs'},answer);return;}
     if(view.kind==='information'){message('Pokračuj tlačítkem Weiter.');return;}
     send('event',{type:view.kind==='exercise'?'practice':'answer',answer},answer);
    }});
   }
   helpMenu(composer);
  }
  box.scrollTop=box.scrollHeight;
 }
 async function leave(target){
  if(translating){translating=false;render();return;}
  if(busy)return;stopSpeech();stopClock();
  const inExam=!!view?.exam;pendingAudio=false;examResult=null;pronunciationClip=null;pronunciationMessage='';examAnswer='';
  if(!inExam&&view?.status==='active'&&user()?.uid===owner){setBusy(true);try{view=await request('event',{type:'pause'});}catch(_){/* Existing saved position remains resumable. */}finally{setBusy(false);}}
  history=[];translations=[];translationDraft='';translationBusy=false;
  generation++;clearRecording();controller?.abort();if(target==='study')window.goLearn();else window.showView('splash');
 }
 async function open(){
  if(busy)return;const current=await window.marcelaAuth.ensureUser();if(!current?.verified)return;
  owner=current.uid;view=null;pendingAudio=false;examResult=null;pronunciationClip=null;pronunciationMessage='';examAnswer='';recorded=null;draft='';selected=[];menuOpen=false;
  translating=false;translationBusy=false;translations=[];translationDraft='';readHistory();generation++;stopSpeech();window.stopTimer?.();window.showView('teacher-view');render();await load();
 }
 function study(){if(active())return leave('study');window.stopTimer?.();window.goLearn();}
 function init(){

  const page=node('div',undefined,'view');page.id='teacher-view';
  const wrap=node('div',undefined,'teacher-wrap'),header=node('header',undefined,'foxly-header');
  const meta=node('div',undefined,'foxly-meta'),clockLabel=node('span'),score=node('span');
  clockLabel.id='foxly-clock';score.id='foxly-score';score.setAttribute('aria-label','Trefferquote');meta.append(clockLabel,score);
  const bar=node('div',undefined,'foxly-bar'),back=button('‹',()=>leave('home'),true);
  back.setAttribute('aria-label','Zurück');
  const title=node('h1');title.id='foxly-title';bar.append(back,title);header.append(meta,bar);
  const box=node('main');box.id='teacher-content';box.setAttribute('role','log');box.setAttribute('aria-live','polite');
  const composer=node('div');composer.id='foxly-composer';
  const status=node('p');status.id='teacher-status';status.setAttribute('role','status');
  const retry=node('div');retry.id='teacher-retry';
  wrap.append(header,box,status,retry,composer);page.append(wrap);document.body.append(page);
  new MutationObserver(()=>{
   if(active()){
    if(!chatTimer)chatTimer=setInterval(()=>{refreshHeader();if(pruneHistory()&&!translating)render();},1000);
   }else{
    stopSpeech();stopClock();clearRecording();pronunciationClip=null;pronunciationMessage='';clearInterval(chatTimer);chatTimer=null;
    box.replaceChildren();composer.replaceChildren();history=[];translations=[];draft='';translationDraft='';
   }
  }).observe(page,{attributes:true,attributeFilter:['class']});
  const viewport=window.visualViewport;
  const resize=()=>{
   if(!viewport)return;
   const atBottom=box.scrollHeight-box.clientHeight-box.scrollTop<24;
   page.style.setProperty('--foxly-height',viewport.height+'px');
   page.style.setProperty('--foxly-top',viewport.offsetTop+'px');
   if(atBottom)box.scrollTop=box.scrollHeight;
  };
  viewport?.addEventListener('resize',resize);
  viewport?.addEventListener('scroll',resize);
  resize();
  document.addEventListener('visibilitychange',()=>{
   if(document.hidden){stopSpeech();stopClock();}
   if(!document.hidden&&document.getElementById('splash')?.classList.contains('active'))void refreshExamResults();
   else{if(active()&&pruneHistory()&&!translating)render();syncClock();void refreshCourse();}
  });
  setInterval(refreshCourse,15000);
  const splash=document.getElementById('splash');
  if(splash)new MutationObserver(()=>{
   if(splash.classList.contains('active'))void refreshExamResults();
  }).observe(splash,{attributes:true,attributeFilter:['class']});
  if(document.getElementById('last-exam-card')&&splash?.classList.contains('active'))void refreshExamResults();
  const card=document.getElementById('study-card');if(card){card.setAttribute('role','button');card.tabIndex=0;card.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();study();}};}
 }
 window.marcelaTeacher=Object.freeze({open,study,resultsForHome,openResults});window._sqLearn=open;
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
