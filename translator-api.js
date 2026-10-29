(function () {
  'use strict';
  // No total text limit: only individual network requests are bounded.
  function chunks(text) {
    const result=[];let rest=String(text).trim();
    while(rest.length>1200) {
      let end=rest.lastIndexOf('\n',1200);
      if(end<600) end=rest.lastIndexOf(' ',1200);
      if(end<600) end=1200;
      if(/[\uD800-\uDBFF]/.test(rest[end-1])) end--;
      result.push(rest.slice(0,end));rest=rest.slice(end).trimStart();
    }
    if(rest) result.push(rest);
    return result;
  }
  let queue=Promise.resolve(),nextRequest=0;
  async function pacedRequest(operation,text,direction) {
    const task=queue.then(async()=>{
      const delay=nextRequest-Date.now();
      if(delay>0) await new Promise(resolve=>setTimeout(resolve,delay));
      nextRequest=Date.now()+8000;
      return request(operation,text,direction);
    });
    queue=task.catch(()=>{});
    return task;
  }
  async function request(operation,text,direction) {
    const body={operation,text};
    if(direction) body.direction=direction;
    const endpoint=window.MARCELA_CONFIG?.translatorEndpoint;
    if(!endpoint) throw new Error('Der Übersetzer wird noch eingerichtet.');
    const response=await fetch(endpoint,{
      method:'POST',headers:{'Content-Type':'application/json',...await window.marcelaAuth.headers()},
      body:JSON.stringify(body),signal:AbortSignal.timeout(40000)
    });
    if(!response.ok) {
      let message='Der Übersetzer ist noch nicht verbunden oder vorübergehend nicht verfügbar.';
      try {const data=await response.json();message=data.error?.message||message;} catch {}
      throw new Error(message);
    }
    return response;
  }
  window.marcelaTranslator=Object.freeze({
    async translate(text,direction,onProgress) {
      const parts=chunks(text),results=[];
      for(let i=0;i<parts.length;i++) {
        const data=await (await pacedRequest('translate',parts[i],direction)).json();
        if(typeof data.text!=='string'||!data.text.trim()) throw new Error('Keine Übersetzung erhalten.');
        results.push(data.text);
        onProgress?.(i+1,parts.length);
      }
      return results.join('\n\n');
    },
    async *speechChunks(text) {
      for(const part of chunks(text)) yield await (await pacedRequest('speech',part)).blob();
    }
  });
})();
