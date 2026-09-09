"use strict";
const list=document.getElementById('position-list');
const status=document.getElementById('position-list-status');
let lastLoadedAt=0;
let refreshSeq=0;

function escapeHtml(value){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function freshUrl(path){
  const sep=path.includes('?')?'&':'?';
  return `${path}${sep}_=${Date.now()}`;
}
function normalizeEntry(item){
  const id=String(item?.id||'').trim();
  if(!/^\d{3,}$/.test(id))return null;
  return {id,title:String(item?.title||'').trim(),generatedAt:String(item?.generatedAt||'')};
}
async function fallbackFirst(){
  try{
    const res=await fetch(freshUrl('data/positions/001.json'),{cache:'no-store'});
    if(!res.ok)return [];
    const data=await res.json();
    return [{id:'001',title:String(data?.title||'').trim(),generatedAt:String(data?.generatedAt||'')}];
  }catch{return []}
}
async function loadEntries(){
  try{
    // GitHub Pages/CDN・ブラウザ双方の古い index.json を避ける。
    const res=await fetch(freshUrl('data/positions/index.json'),{cache:'no-store'});
    if(!res.ok)throw 0;
    const data=await res.json();
    const entries=(Array.isArray(data?.positions)?data.positions:[]).map(normalizeEntry).filter(Boolean);
    if(entries.length)return entries;
  }catch{}
  return fallbackFirst();
}
function render(entries){
  const sorted=[...entries].sort((a,b)=>(Number.parseInt(a.id,10)||0)-(Number.parseInt(b.id,10)||0));
  if(!sorted.length){
    list.innerHTML='';
    status.hidden=false;
    status.textContent='公開済みのポジションはありません。';
    return;
  }
  list.innerHTML=sorted.map(item=>{
    const title=item.title||`Position ${item.id}`;
    return `<a class="position-list-row" href="position.html?id=${encodeURIComponent(item.id)}"><span class="position-list-name">${escapeHtml(title)}</span><span class="position-list-arrow" aria-hidden="true">›</span></a>`;
  }).join('');
  status.hidden=true;
}
async function refreshList(){
  const seq=++refreshSeq;
  const entries=await loadEntries();
  if(seq!==refreshSeq)return;
  render(entries);
  lastLoadedAt=Date.now();
}

refreshList();
// 戻る操作でBFCacheから復帰した場合も最新一覧を取り直す。
window.addEventListener('pageshow',event=>{if(event.persisted)refreshList()});
// 作成ページや個別ページからタブを戻した場合も古い一覧を残さない。
window.addEventListener('focus',()=>{if(Date.now()-lastLoadedAt>1500)refreshList()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastLoadedAt>1500)refreshList()});
