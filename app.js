"use strict";
const AXES=[
  {key:"pc",label:"Post Crawford",html:"Post<br>Crawford",short:"PC"},
  {key:"c",label:"Crawford",short:"C"},
  {key:"2",label:"2away",short:"2a"},
  {key:"3",label:"3away",short:"3a"},
  {key:"4",label:"4away",short:"4a"},
  {key:"5",label:"5away",short:"5a"}
];
const FALLBACK={
  id:"001",title:"",
  board:{points:[0,-2,0,0,0,0,0,0,3,0,0,0,-5,5,0,0,0,-3,0,-5,0,0,0,0,2,0],dice:[3,1],cubeValue:1,cubeOwner:"center",matchLength:5,blackScore:0,whiteScore:0,crawford:false},
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
async function load(){try{const res=await fetch("data/positions/001.json",{cache:"no-store"});if(!res.ok)throw 0;return await res.json()}catch{return FALLBACK}}
function renderTable(data){
  const table=document.getElementById("score-table"),legend=document.getElementById("legend");
  const displayedMoves=[];
  const axisLabel=a=>`<span class="axis-label">${a.short}</span>`;
  let html='<thead><tr><th class="corner" aria-hidden="true"></th>'+AXES.map(a=>`<th class="white-axis">${axisLabel(a)}</th>`).join('')+'</tr></thead><tbody>';
  for(const r of AXES){
    html+=`<tr><th class="black-axis">${axisLabel(r)}</th>`;
    for(const c of AXES){
      if(invalid(r.key,c.key)){
        let note="";
        if(r.key==="c"&&c.key==="pc") note='<span class="invalid-label top">↑UNLIMITED</span>';
        if(r.key==="pc"&&c.key==="c") note='<span class="invalid-label bottom">↓DMP</span>';
        html+=`<td class="score-cell invalid" aria-label="not applicable">${note}</td>`;
        continue;
      }
      const k=keyFor(r.key,c.key);
      const eligible=targetEligible(data,r.key,c.key);
      const item=eligible?((data.results||{})[k]||{}):{};
      const best=item.best||"—",bg=item.best?actionColor(item.best):"";
      if(item.best)displayedMoves.push(item.best);
      html+=`<td class="score-cell ${item.best?'':'empty'}" ${item.best?`data-move="${best.replace(/"/g,'&quot;')}" style="background:${bg}"`:''}><span class="move">${best}</span></td>`;
    }
    html+='</tr>';
  }
  html+='</tbody>';table.innerHTML=html;
  const moves=[...new Set(displayedMoves)];
  legend.innerHTML=moves.length?moves.map(m=>`<span class="legend-item"><span class="legend-swatch" style="background:${actionColor(m)}"></span>${m}</span>`).join(''):'';
}
(async()=>{
  const data=await load();
  const title=document.getElementById('position-title');
  const displayText=String(data.title||data.displayText||'').trim();
  if(displayText){title.textContent=displayText;title.hidden=false}else{title.textContent='';title.hidden=true}
  document.getElementById('board').innerHTML=ScoreMapBoard.render(data.board||{});
  renderTable(data);

  const positionCard=document.querySelector('.position-card');
  const mapCard=document.querySelector('.map-card');
  const syncDesktopHeight=()=>{
    if(window.matchMedia('(min-width:1101px)').matches){
      mapCard.style.height=`${Math.ceil(positionCard.getBoundingClientRect().height)}px`;
    }else{
      mapCard.style.height='';
    }
  };
  requestAnimationFrame(syncDesktopHeight);
  window.addEventListener('resize',syncDesktopHeight,{passive:true});
  if('ResizeObserver' in window){
    new ResizeObserver(syncDesktopHeight).observe(positionCard);
  }
})();
