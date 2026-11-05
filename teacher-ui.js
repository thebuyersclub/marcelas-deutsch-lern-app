/* Persönlicher Unterricht: Antworten werden ausschließlich am Server bewertet. */
(function(){'use strict';
 let view=null,owner=null,busy=false,generation=0,controller=null,audio=null,audioURL=null,speechGeneration=0,speechEnd=null,tick=null,lastTick=0;
 const user=()=>window.marcelaAuth.user(),active=()=>document.getElementById('teacher-view')?.classList.contains('active');
 const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
 function button(label,action,secondary=false){const el=node('button',label,secondary?'teacher-button secondary':'teacher-button');el.type='button';el.disabled=busy;el.onclick=action;return el;}
 function stopSpeech(){speechGeneration++;if(speechEnd){speechEnd();speechEnd=null;}if(audio){audio.pause();audio=null;}if(audioURL){URL.revokeObjectURL(audioURL);audioURL=null;}}
 function clock(){const at=Date.now();if(lastTick&&user()?.uid===owner&&active()&&!document.hidden&&view?.status==='active'){const delta=Math.min(5,Math.floor((at-lastTick)/1000));if(delta>0)window.addSecs?.(delta);}lastTick=at;}
 function stopClock(){if(tick){clock();clearInterval(tick);tick=null;}lastTick=0;}
 function syncClock(){if(active()&&!document.hidden&&view?.status==='active'){if(!tick){lastTick=Date.now();tick=setInterval(clock,4000);}}else stopClock();}
 function content(){return document.getElementById('teacher-content');}
 function message(text){const el=document.getElementById('teacher-status');if(el)el.textContent=text;}
 function setBusy(value){busy=value;document.querySelectorAll('#teacher-view button,#teacher-view textarea').forEach(el=>el.disabled=value);content()?.setAttribute('aria-busy',String(value));}
 async function request(operation,event){
  if(user()?.uid!==owner)throw Error('Bitte erneut anmelden.');
  const seq=generation,body={operation,requestId:crypto.randomUUID()};
  if(['event','review','restart','next'].includes(operation))body.revision=view.revision;
  if(event)body.event={...event,stepId:view.stepId};
  controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),55000);
  try{
   const response=await fetch(window.MARCELA_CONFIG.teacherEndpoint,{method:'POST',headers:{...await window.marcelaAuth.headers(),'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal,cache:'no-store'});
   const result=await response.json();if(seq!==generation||user()?.uid!==owner)throw Error('Unterricht wurde geschlossen.');
   if(!response.ok)throw Error(result.error?.message||'Unterricht ist gerade nicht erreichbar.');return result;
  }finally{clearTimeout(timeout);controller=null;}
 }
 async function send(operation,event){
  if(busy)return;stopSpeech();setBusy(true);message('Einen Moment …');
  try{view=await request(operation,event);render();}
  catch(error){if(active()){message(error.name==='AbortError'?'Die Verbindung hat zu lange gedauert. Bitte den gespeicherten Stand neu laden.':error.message);const retry=button('Gespeicherten Stand laden',()=>load());retry.disabled=false;document.getElementById('teacher-retry').replaceChildren(retry);}}
  finally{setBusy(false);syncClock();}
 }
 async function load(){
  if(busy)return;setBusy(true);message('Unterricht wird geladen …');
  try{view=await request('start');render();}catch(error){message(error.message);const retry=button('Erneut versuchen',load);retry.disabled=false;document.getElementById('teacher-retry').replaceChildren(retry);}finally{setBusy(false);syncClock();}
 }
 async function speak(slow=false){
  stopSpeech();const seq=speechGeneration,text=view?.teacher?.de;if(!text)return;
  const ownerAtStart=owner;
  try{for await(const blob of window.marcelaTranslator.speechChunks(text)){
   if(seq!==speechGeneration||!active()||user()?.uid!==ownerAtStart)return;
   audioURL=URL.createObjectURL(blob);audio=new Audio(audioURL);audio.playbackRate=slow?0.8:1;
   await new Promise((resolve,reject)=>{speechEnd=resolve;audio.onended=resolve;audio.onerror=()=>reject(Error('Vorlesen ist gerade nicht möglich.'));audio.play().catch(reject);});
   speechEnd=null;if(audioURL){URL.revokeObjectURL(audioURL);audioURL=null;}if(seq!==speechGeneration)break;
  }}catch(error){if(seq===speechGeneration&&active())message(error.message);}
 }
 function dialogue(parent, text){
  const scene=node('div',undefined,'teacher-dialogue');
  if(text?.de)scene.append(node('p',text.de,'teacher-bubble teacher-voice teacher-german'));
  if(text?.cz){
   const thought=node('p',text.cz,'teacher-thought teacher-czech');
   thought.lang='cs';
   scene.append(thought);
  }
  parent.append(scene);
  return scene;
 }
 function exerciseInput(parent, exercise){
  if(exercise.prompt){
   const prompt=node('p',exercise.prompt,'teacher-exercise-prompt');
   if(['words','vocabulary','writing'].includes(exercise.mode))prompt.lang='cs';
   parent.append(prompt);
  }
  if(['question','writing'].includes(exercise.mode)){
   answerForm(parent, answer=>send('event',{type:'practice',answer}));
   return;
  }
  if(!['words','sentences'].includes(exercise.mode)){
   for(const item of exercise.items)parent.append(button(item.text,()=>send('event',{type:'practice',itemIds:[item.id]}),true));
   return;
  }
  const selected=[];
  const tray=node('ol',undefined,'teacher-order-tray');
  tray.setAttribute('aria-label','Deine Reihenfolge');
  tray.setAttribute('aria-live','polite');
  const pool=node('div',undefined,'teacher-token-pool');
  const undo=button('↶ Letztes entfernen',()=>{
   selected.pop();
   updateOrder();
  },true);
  const check=button('Reihenfolge prüfen →',()=>{
   if(selected.length!==exercise.items.length){
    message('Tippe zuerst alle Bausteine in deiner Reihenfolge an.');
    return;
   }
   send('event',{type:'practice',itemIds:selected.map(item=>item.id)});
  });
  const tokens=exercise.items.map(item=>button(item.text,()=>{
   if(selected.includes(item))return;
   selected.push(item);
   updateOrder();
  },true));
  function updateOrder(){
   tray.replaceChildren(...selected.map(item=>node('li',item.text)));
   tokens.forEach((token,index)=>token.setAttribute('aria-pressed',String(selected.includes(exercise.items[index]))));
   message('');
  }
  pool.append(...tokens);
  parent.append(tray,pool,undo,check);
  if(exercise.mode==='sentences')parent.classList.add('teacher-sentence-order');
 }
 function answerForm(parent, submitAnswer){
  const form=node('form'), label=node('label','Deine Antwort auf Deutsch'), answer=node('textarea');
  answer.rows=3;
  answer.maxLength=2000;
  answer.autocomplete='off';
  answer.id='teacher-answer';
  label.htmlFor=answer.id;
  const submit=button('Antwort prüfen →',()=>{});
  submit.type='submit';
  form.append(label,answer,submit);
  form.onsubmit=event=>{
   event.preventDefault();
   if(answer.value.trim())submitAnswer(answer.value.trim());
   else answer.focus();
  };
  parent.append(form);
 }
 function controls(parent){
  const help=node('div',undefined,'teacher-help');
  const readAloud=button('Přečíst nahlas',()=>speak(),true);
  readAloud.lang='cs';
  help.append(readAloud);
  for(const phrase of view.helpPhrases||[]){
   const b=button(phrase.cz||phrase.de,async()=>{
    if(['repeat','slower'].includes(phrase.effect)){
     await speak(phrase.effect==='slower');
     return;
    }
    await send('event',{type:'help',action:phrase.effect});
   },true);
   if(phrase.cz)b.lang='cs';
   help.append(b);
  }
  const navigation=node('div',undefined,'teacher-lesson-navigation');
  navigation.append(button('← Pause',()=>leave('home'),true));
  parent.append(navigation,help);
 }
 const statusLabels={retained_later:'Später wieder selbstständig gekonnt',independent_now:'Heute selbstständig gekonnt',practised_with_help_or_recognition:'Mit Hilfe oder Auswahl geübt',observed_at_entry:'Beim Einstieg gelungen',needs_practice:'Weiter üben',not_observed:'Noch nicht geprüft'};
 function render(){
  const box=content();box.replaceChildren();document.getElementById('teacher-retry').replaceChildren();message('');
  if(!view||view.empty){box.append(node('p','Für dieses Konto ist noch kein Unterricht gespeichert.'));return;}
  box.append(node('div',view.title?.de||'Dein Unterricht','teacher-unit'));if(view.title?.cz){const sub=node('p',view.title.cz,'teacher-czech');sub.lang='cs';box.append(sub);}
  if(view.feedback){
   const scene=dialogue(box,view.feedback);
   const reply=node('section',undefined,'teacher-bubble teacher-reply');
   if(view.feedback.correction)reply.append(node('p',view.feedback.correction,'teacher-example'));
   reply.append(button('Weiter',()=>{view.feedback=null;render();}));
   scene.append(reply);
   return;
  }
  if(view.status==='paused'){
   box.append(node('p','Dein Unterricht ist gespeichert. Wir machen an derselben Stelle weiter.'));
   box.append(button('Fortsetzen',()=>send('event',{type:'resume'})));return;
  }
  if(view.status==='complete'){
   dialogue(box,view.teacher);const list=node('ul');for(const goal of view.summary||[])list.append(node('li',(goal.label||goal.goalId)+': '+(statusLabels[goal.status]||'Noch nicht geprüft')));box.append(list);
   if(view.plan?.action==='none')box.append(node('p','Für heute ist keine weitere vorbereitete Einheit fällig. Unter Studieren kannst du weiterüben.'));
   else box.append(button('Nächster Unterricht',()=>send('next')));
   if(view.reviewDueAt){box.append(node('p','Spätere Wiederholung ab '+new Date(view.reviewDueAt).toLocaleString('de-AT')+'.','teacher-czech'));if(Date.now()>=Date.parse(view.reviewDueAt))box.append(button('Wiederholung beginnen',()=>send('review'),true));}
   box.append(button('Diese Einheit noch einmal',()=>send('restart'),true));return;
  }
  const scene=dialogue(box,view.teacher);
  const task=node('section',undefined,'teacher-bubble teacher-reply');
  if(view.kind==='information')task.append(button('Weiter',()=>send('event',{type:'continue'})));
  if(view.kind==='choice'){
   for(const option of view.options||[])task.append(button(option.text||option.de||option.label||option.id,()=>send('event',{type:'choose',optionId:option.id}),true));
  }
  if(view.kind==='free_response')answerForm(task,answer=>send('event',{type:'answer',answer}));
  if(view.kind==='exercise')exerciseInput(task,view.exercise);
  scene.append(task);
  controls(box);
 }
 async function leave(target){
  if(busy)return;stopSpeech();stopClock();
  if(view?.status==='active'&&user()?.uid===owner){setBusy(true);try{view=await request('event',{type:'pause'});}catch(_){/* Existing saved position remains resumable. */}finally{setBusy(false);}}
  generation++;controller?.abort();if(target==='study')window.goLearn();else window.showView('splash');
 }
 async function open(){
  if(busy)return;const current=await window.marcelaAuth.ensureUser();if(!current?.verified)return;
  owner=current.uid;view=null;generation++;stopSpeech();window.stopTimer?.();window.showView('teacher-view');content().replaceChildren();await load();
 }
 function study(){if(active())return leave('study');window.stopTimer?.();window.goLearn();}
 function init(){

  const page=node('div',undefined,'view');page.id='teacher-view';const wrap=node('div',undefined,'teacher-wrap'),nav=node('nav',undefined,'teacher-nav');nav.append(button('Startseite',()=>leave('home'),true),button('Studieren',()=>leave('study'),true));const title=node('h1','Deine Deutschlehrerin'),box=node('main');box.id='teacher-content';const status=node('p');status.id='teacher-status';status.setAttribute('role','status');const retry=node('div');retry.id='teacher-retry';wrap.append(nav,title,box,status,retry);page.append(wrap);document.body.append(page);
  new MutationObserver(()=>{if(!active()){stopSpeech();stopClock();}}).observe(page,{attributes:true,attributeFilter:['class']});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopSpeech();stopClock();}else syncClock();});
  const card=document.getElementById('study-card');if(card){card.setAttribute('role','button');card.tabIndex=0;card.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();study();}};}
 }
 window.marcelaTeacher=Object.freeze({open,study});window._sqLearn=open;
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
