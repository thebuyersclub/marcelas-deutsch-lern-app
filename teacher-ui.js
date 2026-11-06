/* Persönlicher Unterricht: Antworten werden ausschließlich am Server bewertet. */
(function(){'use strict';
 let view=null,owner=null,busy=false,generation=0,controller=null,audio=null,audioURL=null,speechGeneration=0,speechEnd=null,tick=null,lastTick=0;
 const retention=48*3600000;
 let history=[],translations=[],translating=false,translationBusy=false,translationDraft='',draft='',selected=[],menuOpen=false,chatTimer=null;
 const user=()=>window.marcelaAuth.user(),active=()=>document.getElementById('teacher-view')?.classList.contains('active');
 const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
 function button(label,action,secondary=false){const el=node('button',label,secondary?'teacher-button secondary':'teacher-button');el.type='button';el.disabled=busy;el.onclick=action;return el;}
 function stopSpeech(){speechGeneration++;if(speechEnd){speechEnd();speechEnd=null;}if(audio){audio.pause();audio=null;}if(audioURL){URL.revokeObjectURL(audioURL);audioURL=null;}}
 function clock(){const at=Date.now();if(lastTick&&user()?.uid===owner&&active()&&!document.hidden&&view?.status==='active'){const delta=Math.min(5,Math.floor((at-lastTick)/1000));if(delta>0)window.addSecs?.(delta);}lastTick=at;}
 function stopClock(){if(tick){clock();clearInterval(tick);tick=null;}lastTick=0;}
 function syncClock(){if(active()&&!document.hidden&&view?.status==='active'){if(!tick){lastTick=Date.now();tick=setInterval(clock,4000);}}else stopClock();}
 function content(){return document.getElementById('teacher-content');}
 function message(text){const el=document.getElementById('teacher-status');if(el)el.textContent=text;}
 function setBusy(value){busy=value;document.querySelectorAll('#teacher-view button').forEach(el=>el.disabled=value);content()?.setAttribute('aria-busy',String(value));}
 async function request(operation,event){
  if(user()?.uid!==owner)throw Error('Bitte erneut anmelden.');
  const seq=generation,body={operation,chat:true,requestId:crypto.randomUUID()};
  if(['event','review','restart','next'].includes(operation))body.revision=view.revision;
  if(event)body.event={...event,stepId:view.stepId};
  controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),55000);
  try{
   const response=await fetch(window.MARCELA_CONFIG.teacherEndpoint,{method:'POST',headers:{...await window.marcelaAuth.headers(),'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal,cache:'no-store'});
   const result=await response.json();if(seq!==generation||user()?.uid!==owner)throw Error('Unterricht wurde geschlossen.');
   if(!response.ok)throw Error(result.error?.message||'Unterricht ist gerade nicht erreichbar.');return result;
  }finally{clearTimeout(timeout);controller=null;}
 }
 async function send(operation,event,outgoing){
  if(busy)return;stopSpeech();setBusy(true);message('Einen Moment …');
  try{
   const result=await request(operation,event);
   if(outgoing)remember({id:result.sessionId+':answer:'+result.revision,side:'right',de:outgoing});
   if(result.feedback)remember({id:result.sessionId+':feedback:'+result.revision,side:'left',...result.feedback});
   rememberChapterFarewell(result);
   if(outgoing||result.stepId!==view?.stepId){draft='';selected=[];}
   view=result;menuOpen=false;render();
  }
  catch(error){if(active()){message(error.name==='AbortError'?'Die Verbindung hat zu lange gedauert. Bitte den gespeicherten Stand neu laden.':error.message);const retry=button('Gespeicherten Stand laden',()=>load());retry.disabled=false;document.getElementById('teacher-retry').replaceChildren(retry);}}
  finally{setBusy(false);syncClock();}
 }
 async function load(){
  if(busy)return;setBusy(true);message('Unterricht wird geladen …');
  try{view=await request('start');rememberChapterFarewell(view);render();}catch(error){message(error.message);const retry=button('Erneut versuchen',load);retry.disabled=false;document.getElementById('teacher-retry').replaceChildren(retry);}finally{setBusy(false);syncClock();}
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
 function remember(item,updateTask=false){
  pruneHistory();
  if(!item.de)return;
  const existing=history.find(entry=>entry.id===item.id);
  if(existing){
   if(updateTask&&['de','cz','prompt','promptLang','needsTranslation'].some(key=>existing[key]!==item[key])){
    Object.assign(existing,item);delete existing.translated;saveHistory();
   }
   return;
  }
  history.push({...item,at:item.at??Date.now()});saveHistory();
 }
 function rememberChapterFarewell(result){
  if(result.chapterFarewell?.at>Date.now()-retention)
   remember({id:result.sessionId+':chapter-farewell',side:'right',report:true,...result.chapterFarewell});
 }
 const localTime=at=>new Date(at).toLocaleTimeString('de-AT',{hour:'2-digit',minute:'2-digit'});
 const goodnight=text=>/^(gute nacht|dobrou noc)[.!?]*$/iu.test(text.trim());
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
  answer.placeholder=translating?'Napiš německy nebo česky…':'Napiš zprávu…';
  answer.setAttribute('aria-label',answer.placeholder);answer.value=value;
  answer.oninput=()=>onInput(answer.value);
  form.append(answer);sendButton(form);
  form.onsubmit=event=>{
   event.preventDefault();
   if(translating?translationBusy:busy)return;
   const text=answer.value.trim();
   if(!text){answer.focus();return;}
   answer.blur();
   onSend(text);
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
  try{
   const result=await window.marcelaTranslator.translate(text,'auto');
   if(account!==owner||turn!==generation||user()?.uid!==account)return;
   translations.push({de:text,side:'right',at:Date.now()},{de:result,side:'left',at:Date.now()});
   translationDraft='';if(translating)render();
  }catch(error){if(translating&&account===owner&&turn===generation)message(error.message);}
  finally{
   if(account===owner&&turn===generation){
    translationBusy=false;
    if(translating){
     const status=document.getElementById('teacher-status').textContent;
     render();if(status)message(status);
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
  document.getElementById('foxly-score').textContent=translating?'':view?.score==null?'— %':view.score+' %';
  document.getElementById('foxly-title').textContent=translating?'Übersetzer / Překlad':'Foxly – Spaß beim Lernen';
 }
 function render(){
  const box=content(),composer=document.getElementById('foxly-composer');
  const focused=document.activeElement;
  const textTask=view?.status==='active'&&view.kind!=='choice'&&!view.exercise?.items?.length;
  const composerMode=translating?'translation':view?.kind||'';
  const keepInput=focused?.className==='foxly-text-input'&&composer.contains(focused)&&
   composer.dataset.mode===composerMode&&(translating||textTask);
  box.replaceChildren();
  if(!keepInput){
   composer.replaceChildren();
   composer.dataset.mode=composerMode;
  }
  document.getElementById('teacher-retry').replaceChildren();message('');
  refreshHeader();
  if(translating){
   box.append(...translations.map(bubble));
   if(keepInput)focused.value=translationDraft;
   else textComposer(composer,{value:translationDraft,onInput:value=>{translationDraft=value;},onSend:translate});
   if(translationBusy)message('Překládám…');
  }else if(view&&!view.empty){
   if(!view.endedEarly&&view.status!=='paused'){
    const exercise=view.exercise;
    remember({id:view.sessionId+':task:'+view.stepId,side:'left',...view.teacher,
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
     if(goodnight(answer)){send('event',{type:'goodnight'},answer);return;}
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
  if(view?.status==='active'&&user()?.uid===owner){setBusy(true);try{view=await request('event',{type:'pause'});}catch(_){/* Existing saved position remains resumable. */}finally{setBusy(false);}}
  history=[];translations=[];translationDraft='';translationBusy=false;
  generation++;controller?.abort();if(target==='study')window.goLearn();else window.showView('splash');
 }
 async function open(){
  if(busy)return;const current=await window.marcelaAuth.ensureUser();if(!current?.verified)return;
  owner=current.uid;view=null;draft='';selected=[];menuOpen=false;
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
    stopSpeech();stopClock();clearInterval(chatTimer);chatTimer=null;
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
   else{if(active()&&pruneHistory()&&!translating)render();syncClock();}
  });
  const card=document.getElementById('study-card');if(card){card.setAttribute('role','button');card.tabIndex=0;card.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();study();}};}
 }
 window.marcelaTeacher=Object.freeze({open,study});window._sqLearn=open;
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
