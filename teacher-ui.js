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
 function bilingual(parent,text){if(text?.de)parent.append(node('p',text.de,'teacher-german'));if(text?.cz){const cz=node('p',text.cz,'teacher-czech');cz.lang='cs';parent.append(cz);}}
 const statusLabels={retained_later:'Später wieder selbstständig gekonnt',independent_now:'Heute selbstständig gekonnt',practised_with_help_or_recognition:'Mit Hilfe oder Auswahl geübt',observed_at_entry:'Beim Einstieg gelungen',needs_practice:'Weiter üben',not_observed:'Noch nicht geprüft'};
 function render(){
  const box=content();box.replaceChildren();document.getElementById('teacher-retry').replaceChildren();message('');
  if(!view||view.empty){box.append(node('p','Für dieses Konto ist noch kein Unterricht gespeichert.'));return;}
  box.append(node('div',view.title?.de||'Dein Unterricht','teacher-unit'));if(view.title?.cz){const sub=node('p',view.title.cz,'teacher-czech');sub.lang='cs';box.append(sub);}
  if(view.feedback){
   const feedback=node('section',undefined,'teacher-card');bilingual(feedback,view.feedback);if(view.feedback.correction)feedback.append(node('p',view.feedback.correction,'teacher-example'));
   feedback.append(button('Weiter',()=>{view.feedback=null;render();}));box.append(feedback);return;
  }
  if(view.status==='paused'){
   box.append(node('p','Dein Unterricht ist gespeichert. Wir machen an derselben Stelle weiter.'));
   box.append(button('Fortsetzen',()=>send('event',{type:'resume'})));return;
  }
  if(view.status==='complete'){
   bilingual(box,view.teacher);const list=node('ul');for(const goal of view.summary||[])list.append(node('li',(goal.label||goal.goalId)+': '+(statusLabels[goal.status]||'Noch nicht geprüft')));box.append(list);
   if(view.plan?.action==='none')box.append(node('p','Für heute ist keine weitere vorbereitete Einheit fällig. Unter Studieren kannst du weiterüben.'));
   else box.append(button('Nächster Unterricht',()=>send('next')));
   if(view.reviewDueAt){box.append(node('p','Spätere Wiederholung ab '+new Date(view.reviewDueAt).toLocaleString('de-AT')+'.','teacher-czech'));if(Date.now()>=Date.parse(view.reviewDueAt))box.append(button('Wiederholung beginnen',()=>send('review'),true));}
   box.append(button('Diese Einheit noch einmal',()=>send('restart'),true));return;
  }
  const task=node('section',undefined,'teacher-card');bilingual(task,view.teacher);
  task.append(button('Vorlesen',()=>speak(),true));
  if(view.kind==='information')task.append(button('Weiter',()=>send('event',{type:'continue'})));
  if(view.kind==='choice')for(const option of view.options||[])task.append(button(option.text||option.de||option.label||option.id,()=>send('event',{type:'choose',optionId:option.id})));
  if(view.kind==='free_response'){
   const form=node('form'),label=node('label','Deine Antwort auf Deutsch'),answer=node('textarea');answer.rows=3;answer.maxLength=2000;answer.autocomplete='off';answer.id='teacher-answer';label.htmlFor=answer.id;
   form.append(label,answer);const submit=button('Antwort prüfen',()=>{});submit.type='submit';form.append(submit);form.onsubmit=event=>{event.preventDefault();if(answer.value.trim())send('event',{type:'answer',answer:answer.value.trim()});else answer.focus();};task.append(form);
  }
  box.append(task);
  const help=node('div',undefined,'teacher-help');for(const phrase of view.helpPhrases||[]){const b=button(phrase.de,async()=>{await send('event',{type:'help',action:phrase.effect});if(['repeat','slower'].includes(phrase.effect))speak(phrase.effect==='slower');},true);b.title=phrase.cz||'';help.append(b);}box.append(help);
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
  const style=node('style');style.textContent='#teacher-view{background:var(--cream,#fafaf7);color:var(--ink,#211e1a);font-family:Nunito,system-ui}#teacher-view .teacher-wrap{width:100%;max-width:640px;margin:0 auto;padding:calc(64px + env(safe-area-inset-top,0px)) 18px calc(30px + env(safe-area-inset-bottom));box-sizing:border-box}.teacher-nav{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.teacher-unit{font-size:23px;font-weight:900;margin-top:22px}.teacher-card{background:white;border-radius:20px;padding:22px;margin:20px 0;box-shadow:0 5px 24px #00000009}.teacher-german{font-size:21px;font-weight:800;line-height:1.5;white-space:pre-wrap}.teacher-czech{color:var(--ink3,#716b63);font-size:15px;line-height:1.5;white-space:pre-wrap}.teacher-button{font:800 15px Nunito,system-ui;background:var(--terra,#bd7758);color:white;border:0;border-radius:14px;padding:13px 18px;margin:6px 7px 6px 0;cursor:pointer;min-height:44px}.teacher-button.secondary{background:white;color:var(--ink,#211e1a);border:1px solid #ded8d0}.teacher-button:disabled{opacity:.55;cursor:wait}#teacher-view textarea{width:100%;box-sizing:border-box;border:1px solid #d7cfc4;border-radius:12px;font:18px Nunito,system-ui;padding:12px;margin:10px 0;resize:vertical}#teacher-view label{display:block;margin-top:20px;font-weight:800}.teacher-example{font-size:19px;font-weight:800}.teacher-help{margin-top:18px}#teacher-status{min-height:24px;line-height:1.5}#teacher-content li{padding:7px 0;line-height:1.5}';document.head.append(style);
  const page=node('div',undefined,'view');page.id='teacher-view';const wrap=node('div',undefined,'teacher-wrap'),nav=node('nav',undefined,'teacher-nav');nav.append(button('Startseite',()=>leave('home'),true),button('Studieren',()=>leave('study'),true));const title=node('h1','Deine Deutschlehrerin'),box=node('main');box.id='teacher-content';const status=node('p');status.id='teacher-status';status.setAttribute('role','status');const retry=node('div');retry.id='teacher-retry';wrap.append(nav,title,box,status,retry);page.append(wrap);document.body.append(page);
  new MutationObserver(()=>{if(!active()){stopSpeech();stopClock();}}).observe(page,{attributes:true,attributeFilter:['class']});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopSpeech();stopClock();}else syncClock();});
  const card=document.getElementById('study-card');if(card){card.setAttribute('role','button');card.tabIndex=0;card.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();study();}};}
 }
 window.marcelaTeacher=Object.freeze({open,study});window._sqLearn=open;
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
