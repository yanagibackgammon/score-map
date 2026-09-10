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
    const res=await fetch(freshUrl('data/positions/index.json'),{cache:'no-store'});
    if(!res.ok)throw 0;
    const data=await res.json();
    const entries=(Array.isArray(data?.positions)?data.positions:[]).map(normalizeEntry).filter(Boolean);
    if(entries.length)return entries;
  }catch{}
  return fallbackFirst();
}
async function loadPosition(entry){
  try{
    const res=await fetch(freshUrl(`data/positions/${encodeURIComponent(entry.id)}.json`),{cache:'no-store'});
    if(!res.ok)throw 0;
    const data=await res.json();
    return {...entry,title:String(data?.title||entry.title||'').trim(),board:data?.board||null};
  }catch{
    return {...entry,board:null};
  }
}
function boardHtml(board){
  if(!board||!window.ScoreMapBoard?.render)return '<div class="position-list-board-missing">盤面を読み込めませんでした</div>';
  try{return ScoreMapBoard.render(board)}catch{return '<div class="position-list-board-missing">盤面を読み込めませんでした</div>'}
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
    return `<a class="position-list-card" href="position.html?id=${encodeURIComponent(item.id)}" aria-label="${escapeHtml(title)}を開く">
      <div class="position-list-caption">${escapeHtml(title)}</div>
      <div class="position-list-board">${boardHtml(item.board)}</div>
    </a>`;
  }).join('');
  status.hidden=true;
}
async function refreshList(){
  const seq=++refreshSeq;
  const entries=await loadEntries();
  const positions=await Promise.all(entries.map(loadPosition));
  if(seq!==refreshSeq)return;
  render(positions);
  lastLoadedAt=Date.now();
}

refreshList();
window.addEventListener('pageshow',event=>{if(event.persisted)refreshList()});
window.addEventListener('focus',()=>{if(Date.now()-lastLoadedAt>1500)refreshList()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastLoadedAt>1500)refreshList()});
