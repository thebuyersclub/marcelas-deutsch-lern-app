/* Sonderkapitel bündeln vorhandene Karten; Lernfunktionen und Ereignisse bleiben erhalten. */
(function(){
  'use strict';
  function grouped(original,containerId,grid){
    const container=document.getElementById(containerId);
    if(!container)return original();
    const expanded=new Set(Array.from(container.querySelectorAll('details[data-chapter-group][open]')).map(el=>el.dataset.chapterGroup));
    const result=original(),groups=new Map();
    (_cache.chapters||[]).forEach(ch=>{
      const group=ch.specialGroup;
      if(!group||!/^[-a-z0-9]+$/.test(group.id))return;
      if(!groups.has(group.id))groups.set(group.id,{...group,chapters:[]});
      groups.get(group.id).chapters.push(ch);
    });
    const cards=Array.from(container.querySelectorAll(grid?'.bento-card[data-chapter-id]':'.ch-card'));
    for(const group of groups.values()){
      const members=cards.filter(card=>group.chapters.some(ch=>grid?card.dataset.chapterId===ch.id:card.getAttribute('onclick')==="openChapter('"+ch.id+"')"));
      if(!members.length)continue;
      const details=document.createElement('details');details.dataset.chapterGroup=group.id;details.open=expanded.has(group.id);
      details.style.cssText='grid-column:1/-1;background:var(--cream);border:1px solid var(--ink3);border-radius:20px;padding:16px;margin:8px 0';
      const summary=document.createElement('summary');summary.style.cssText='cursor:pointer;font-weight:900;font-size:19px;line-height:1.5';
      const de=document.createElement('span');de.textContent=group.nameDe;
      const cz=document.createElement('span');cz.textContent=group.nameCz;cz.style.cssText='display:block;font-size:15px;color:var(--purple)';
      const meta=document.createElement('span');meta.textContent='Sonderkapitel · '+members.length+' Unterkapitel / podkapitol · Zum Öffnen tippen';meta.style.cssText='display:block;font-size:12px;font-weight:600';
      summary.append(de,cz,meta);details.append(summary);
      const inner=document.createElement('div');inner.className=grid?'bento-grid':'ch-list';inner.style.marginTop='16px';details.append(inner);
      members[0].before(details);members.forEach(card=>inner.append(card));
    }
    return result;
  }
  const learn=window.renderLearnList,admin=window.renderAdminList;
  window.renderLearnList=function(){return grouped(learn,'learn-ch-list',true);};
  window.renderAdminList=function(){return grouped(admin,'admin-ch-list',false);};
})();
