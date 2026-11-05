/* Beide Konten lernen und testen; gemeinsame Inhalte werden in Google Sheets gepflegt. */
(function(){
 'use strict';
 function install(){
  const user=window.marcelaAuth.user();if(!user?.verified||document.getElementById('account-tools'))return;
  const box=document.createElement('div');box.id='account-tools';
  box.style.cssText='margin:12px auto;padding:12px 12px 104px;max-width:680px;background:#fff;border-radius:14px;font-family:Nunito,system-ui';
      box.innerHTML='<details><summary>Wort oder Satz hinzufügen</summary><form style="display:grid;gap:10px;margin-top:12px"><label>Art <select name="type"><option value="vocab">Wort</option><option value="sentence">Satz</option></select></label><label>Deutsch <input name="de" required maxlength="2000"></label><label>Tschechisch <input name="cz" required maxlength="2000"></label><label>Beispiel <input name="example" maxlength="4000"></label><button type="submit">Hinzufügen</button><p role="status"></p></form></details>';
      const form=box.querySelector('form');form.addEventListener('submit',async event=>{
        event.preventDefault();const button=form.querySelector('button');button.disabled=true;
        try{await window.marcelaData.addEntry(form.elements.type.value,form.elements.de.value,form.elements.cz.value,form.elements.example.value);form.reset();form.querySelector('[role=status]').textContent='Hinzugefügt. Du findest den Eintrag unter „Eigene Wörter und Sätze“.';window.renderLearnList();}
        catch(error){form.querySelector('[role=status]').textContent=error.message;}
        finally{button.disabled=false;}
      });document.getElementById('learn-home').querySelector('.scroll').append(box);
      const retry=document.createElement('button');retry.type='button';retry.textContent='Lernstand erneut speichern';
      retry.addEventListener('click',async()=>{retry.disabled=true;try{await window.marcelaData.retryPending();}catch(error){window.marcelaData.status(error.message,true);}finally{retry.disabled=false;}});box.append(retry);
      const local=document.createElement('button');local.type='button';local.textContent='Lokalen Lernstand sichern';
      local.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(window.marcelaData.localBackup(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='marcela-lokaler-lernstand.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});box.append(local);
 }
 const originalShow=window.showView;
 window.showView=function(id){
   if(['home','chapter-detail','new-chapter'].includes(id))id='learn-home';
   const result=originalShow(id);install();return result;
 };
 // Auch Übersetzungen werden als Ergänzungen gespeichert, niemals im gemeinsamen Kapitel.
 window.saveTranslation=async function(type){
   const fromDE=_trDir==='de-cz',input=document.getElementById('tr-input').value.trim();
   const de=fromDE?input:_trResult,cz=fromDE?_trResult:input;
   if(!de||!cz){showToast('Bitte zuerst übersetzen','err');return;}
   try{await window.marcelaData.addEntry(type,de,cz);showToast('Unter „Eigene Wörter und Sätze“ hinzugefügt','ok');}
   catch(e){showToast(e.message,'err');}
 };
 // Kein Verwaltungseinstieg und keine Verwaltungsansicht, auch nicht im Testkonto.
 document.getElementById('btn-admin')?.remove();
 for(const id of ['home','chapter-detail','new-chapter']){
   const view=document.getElementById(id);if(view){view.hidden=true;view.setAttribute('aria-hidden','true');}
 }
})();
