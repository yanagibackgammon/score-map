"use strict";
const list=document.getElementById('position-list');
const status=document.getElementById('position-list-status');
function escapeHtml(value){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function normalizeEntry(item){
  const id=String(item?.id||'').trim();
  if(!/^\d{3,}$/.test(id))return null;
  return {id,title:String(item?.title||'').trim(),generatedAt:String(item?.generatedAt||'')};
}
async function fallbackFirst(){
  try{
    const res=await fetch('data/positions/001.json',{cache:'no-store'});
    if(!res.ok)return [];
    const data=await res.json();
    return [{id:'001',title:String(data?.title||'').trim(),generatedAt:String(data?.generatedAt||'')}];
  }catch{return []}
}
async function loadEntries(){
  try{
    const res=await fetch('data/positions/index.json',{cache:'no-store'});
    if(!res.ok)throw 0;
    const data=await res.json();
    const entries=(Array.isArray(data?.positions)?data.positions:[]).map(normalizeEntry).filter(Boolean);
    if(entries.length)return entries;
  }catch{}
  return fallbackFirst();
}
function render(entries){
  const sorted=[...entries].sort((a,b)=>(Number.parseInt(a.id,10)||0)-(Number.parseInt(b.id,10)||0));
  if(!sorted.length){status.textContent='公開済みのポジションはありません。';return}
  list.innerHTML=sorted.map(item=>{
    const title=item.title||`Position ${item.id}`;
    return `<a class="position-list-row" href="position.html?id=${encodeURIComponent(item.id)}"><span class="position-list-name">${escapeHtml(title)}</span><span class="position-list-arrow" aria-hidden="true">›</span></a>`;
  }).join('');
  status.hidden=true;
}
loadEntries().then(render);
