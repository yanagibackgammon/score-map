"use strict";
const AXES=[
  {key:"pc",short:"PC"},
  {key:"c",short:"C"},
  {key:"2",short:"2a"},
  {key:"3",short:"3a"},
  {key:"4",short:"4a"},
  {key:"5",short:"5a"}
];
const FALLBACK={
  id:"001",title:"",
  board:{points:[0,-2,0,0,0,0,0,0,3,0,0,0,-5,5,0,0,0,-3,0,-5,0,0,0,0,2,0],dice:[],cubeValue:1,cubeOwner:"center",matchLength:5,blackScore:0,whiteScore:0,crawford:false},
  results:{}
};
const invalid=(r,c)=>(r==="pc"&&c==="c")||(r==="c"&&c==="pc");
const keyFor=(r,c)=>r==="pc"&&c==="pc"?"unlimited":r==="c"&&c==="c"?"dmp":`${r}-${c}`;
function awayForAxis(key){return key==="pc"||key==="c"?1:Number(key)}
function derivedTargetEligible(data,r,c){
  if(invalid(r,c))return false;
  if(r==="c"||c==="c")return false;
  if(r==="pc"&&c==="pc")return true;
  const board=data?.board||{};
  if(String(board.cubeOwner||"center").toLowerCase()==="white")return false;
  const cubeValue=Math.max(1,Number(board.cubeValue)||1);
  if(cubeValue>=awayForAxis(r))return false;
  const maxCube=Number(board.maxCube);
  if(Number.isFinite(maxCube)&&maxCube>=0){
    const exp=Math.log2(cubeValue);
    if(Number.isFinite(exp)&&exp>=maxCube)return false;
  }
  return true;
}
function targetEligible(data,r,c){
  const targets=Array.isArray(data?.analysisTargets)?new Set(data.analysisTargets):null;
  if(targets)return targets.has(keyFor(r,c));
  return derivedTargetEligible(data,r,c);
}
function derivedAutomatic(data,r,c){
  if(!derivedTargetEligible(data,r,c))return false;
  if(r==="pc"&&c==="pc")return false;
  const cubeValue=Math.max(1,Number(data?.board?.cubeValue)||1);
  return cubeValue>=awayForAxis(c)&&cubeValue<awayForAxis(r);
}
function isAutomatic(data,r,c){
  const targets=Array.isArray(data?.automaticTargets)?new Set(data.automaticTargets):null;
  if(targets)return targets.has(keyFor(r,c));
  return derivedAutomatic(data,r,c);
}
const ACTION_COLORS={
  noDouble:"#CCFFFF",
  doubleTake:"#CCFFCC",
  doublePass:"#FFFFCC",
  tooGood:"#FFCCCC",
  other:"#E5E7EB"
};
function actionColor(action){
  const value=String(action||"").toLowerCase().replace(/\s+/g,"");
  if(value.includes("toogood"))return ACTION_COLORS.tooGood;
  if(value.includes("/pass"))return ACTION_COLORS.doublePass;
  if(value.includes("/take")){
    if(value.startsWith("no")||value.includes("nodouble")||value.includes("noredouble"))return ACTION_COLORS.noDouble;
    return ACTION_COLORS.doubleTake;
  }
  if(value.includes("nodouble")||value.includes("noredouble"))return ACTION_COLORS.noDouble;
  return ACTION_COLORS.other;
}
function requestedId(){
  const raw=new URLSearchParams(location.search).get("id")||"001";
  return /^\d{3,}$/.test(raw)?raw:"001";
}
async function load(){
  const id=requestedId();
  try{
    const res=await fetch(`data/positions/${encodeURIComponent(id)}.json`,{cache:"no-store"});
    if(!res.ok)throw new Error("not found");
    return await res.json();
  }catch{
    return {...FALLBACK,id};
  }
}
function errorAlternative(item){
  const candidates=Array.isArray(item?.candidates)?item.candidates:[];
  if(!item?.best||!candidates.length)return null;
  const norm=value=>String(value||"").toLowerCase().replace(/\s+/g,"");
  const best=norm(item.best);
  let candidate=null;
  if(best.includes("nodouble")||best.includes("noredouble")||best.includes("toogood")){
    const doubles=candidates.filter(c=>{const m=norm(c.move);return m.includes("/take")||m.includes("/pass")});
    if(doubles.length)candidate=doubles.reduce((a,b)=>Number(a.equity)<=Number(b.equity)?a:b);
  }else{
    candidate=candidates.find(c=>{const m=norm(c.move);return m.includes("nodouble")||m.includes("noredouble")})||null;
  }
  if(!candidate)return null;
  const bestEq=Number(item.equity);
  const candEq=Number(candidate.equity);
  let diff=Number(candidate.diff);
  if(!Number.isFinite(diff)&&Number.isFinite(bestEq)&&Number.isFinite(candEq))diff=bestEq-candEq;
  if(!Number.isFinite(diff))return null;
  diff=Math.max(0,diff);
  return {move:String(candidate.move||""),diff};
}
function formatErrorValue(value){return `-${Math.max(0,Number(value)||0).toFixed(3)}`}
function escapeHtml(value){return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function renderTable(data){
  const table=document.getElementById("score-table");
  const axisLabel=a=>`<span class="axis-label">${a.short}</span>`;
  let html='<thead><tr><th class="corner" aria-hidden="true"></th>'+AXES.map(a=>`<th class="white-axis">${axisLabel(a)}</th>`).join('')+'</tr></thead><tbody>';
  for(const r of AXES){
    html+=`<tr><th class="black-axis">${axisLabel(r)}</th>`;
    for(const c of AXES){
      if(invalid(r.key,c.key)){
        let note="";
        if(r.key==="c"&&c.key==="pc")note='<span class="invalid-label top">↑UNLIMITED</span>';
        if(r.key==="pc"&&c.key==="c")note='<span class="invalid-label bottom">↓DMP</span>';
        html+=`<td class="score-cell invalid" aria-label="not applicable">${note}</td>`;
        continue;
      }
      const k=keyFor(r.key,c.key);
      const eligible=targetEligible(data,r.key,c.key);
      const item=eligible?((data.results||{})[k]||{}):{};
      const best=item.best||"—";
      const bg=item.best?actionColor(item.best):"";
      const automatic=item.best&&isAutomatic(data,r.key,c.key);
      const automaticHtml=automatic?'<span class="automatic-label">Automatic</span>':"";
      const error=item.best?errorAlternative(item):null;
      const errorHtml=error?`<span class="error-line"><span class="error-action">${escapeHtml(error.move)}</span><span class="error-value">${formatErrorValue(error.diff)}</span></span>`:"";
      html+=`<td class="score-cell ${item.best?'':'empty'} ${automatic?'automatic':''}" ${item.best?`data-move="${escapeHtml(best)}" style="background:${bg}"`:''}>${automaticHtml}<span class="move">${escapeHtml(best)}</span>${errorHtml}</td>`;
    }
    html+='</tr>';
  }
  html+='</tbody>';
  table.innerHTML=html;
}
(async()=>{
  const data=await load();
  const title=document.getElementById('position-title');
  const displayText=String(data.title||data.displayText||'').trim();
  if(displayText){title.textContent=displayText;title.hidden=false;document.title=`${displayText} | Score Map`}else{title.textContent='';title.hidden=true}
  document.getElementById('board').innerHTML=ScoreMapBoard.render(data.board||{});
  renderTable(data);

  const positionCard=document.querySelector('.position-card');
  const mapCard=document.querySelector('.map-card');
  const syncDesktopHeight=()=>{
    if(window.matchMedia('(min-width:1101px)').matches)mapCard.style.height=`${Math.ceil(positionCard.getBoundingClientRect().height)}px`;
    else mapCard.style.height='';
  };
  requestAnimationFrame(syncDesktopHeight);
  window.addEventListener('resize',syncDesktopHeight,{passive:true});
  if('ResizeObserver' in window)new ResizeObserver(syncDesktopHeight).observe(positionCard);
})();
