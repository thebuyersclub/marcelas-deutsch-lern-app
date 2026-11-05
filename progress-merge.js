/* Gemeinsame, versionsgeprüfte Zusammenführung persönlicher Lernstände. */
(function(root){'use strict';const clone=v=>JSON.parse(JSON.stringify(v));
  function progressOf(data){return {stats:data.stats||{},streak:data.streak||0,weak:data.weak||{},examRecords:data.examRecords||{},resets:data.resets||{},learningEvidence:data.learningEvidence||{},legacyImported:data.legacyImported===true,...(data._migration?{_migration:data._migration}:{})};}
  function mergeProgress(remote,baseline,local){
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    function merge(r,b,l){
      if(same(l,b))return clone(r===undefined?null:r);
      if(same(r,b)||r===undefined)return l===undefined?undefined:clone(l);
      if(l===undefined)return r; // Gleichzeitig erneut falsch beantwortete Einträge bleiben erhalten.
      if(r&&l&&typeof r==='object'&&typeof l==='object'&&!Array.isArray(r)&&!Array.isArray(l)){
        if(Number.isFinite(r.ts)&&Number.isFinite(l.ts))return clone(l.ts>r.ts?l:r);
        const out={};for(const key of new Set([...Object.keys(r),...Object.keys(b||{}),...Object.keys(l)])){
          const v=merge(r[key],b?.[key],l[key]);if(v!==undefined)Object.defineProperty(out,key,{value:v,enumerable:true,writable:true,configurable:true});
        }return out;
      }
      return clone(r); // Gleichzeitige widersprüchliche Änderungen nicht blind ersetzen.
    }
    const out=merge(progressOf(remote),progressOf(baseline),progressOf(local));out.stats={...(remote.stats||{})};
    for(const day of new Set([...Object.keys(baseline.stats||{}),...Object.keys(local.stats||{})])){
      const delta=Number(local.stats?.[day]||0)-Number(baseline.stats?.[day]||0);
      const reset=local.resets?.[day],oldReset=baseline.resets?.[day];
      if(reset?.id&&reset.id!==oldReset?.id&&Number(reset.ts)>Number(remote.resets?.[day]?.ts||0))out.stats[day]=Number(local.stats?.[day]||0);
      else if(delta>0)out.stats[day]=Number(remote.stats?.[day]||0)+delta;
    }
    const observations=new Map();
    for(const ledger of [remote.learningEvidence,local.learningEvidence])for(const event of Object.values(ledger||{})){
      if(event&&event.version===1&&typeof event.id==='string'&&Number.isFinite(event.ts)&&!observations.has(event.id))observations.set(event.id,event);
    }
    out.learningEvidence=Object.fromEntries([...observations.values()].sort((a,b)=>b.ts-a.ts||a.id.localeCompare(b.id)).slice(0,500).map(e=>[e.id,e]));
    out.legacyImported=!!(remote.legacyImported||local.legacyImported);
    out.streak=0;const date=new Date();
    for(let i=0;i<730;i++){
      const day=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
      if(Number(out.stats[day]||0)<3600)break;out.streak++;date.setDate(date.getDate()-1);
    }
    return out;
  }

const api={merge:mergeProgress,fields:progressOf};if(typeof module==='object')module.exports=api;else root.marcelaProgress=Object.freeze(api);
})(typeof window==='object'?window:globalThis);
