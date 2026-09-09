"use strict";
const AXES=[
  {key:"pc",label:"Post Crawford",html:"Post<br>Crawford"},
  {key:"c",label:"Crawford"},
  {key:"2",label:"2away"},
  {key:"3",label:"3away"},
  {key:"4",label:"4away"},
  {key:"5",label:"5away"}
];
const FALLBACK={
  id:"001",title:"",
  board:{points:[0,-2,0,0,0,0,0,0,3,0,0,0,-5,5,0,0,0,-3,0,-5,0,0,0,0,2,0],dice:[3,1],cubeValue:1,cubeOwner:"center",matchLength:5,blackScore:0,whiteScore:0,crawford:false},
  results:{}
};
const invalid=(r,c)=>(r==="pc"&&c==="c")||(r==="c"&&c==="pc");
const keyFor=(r,c)=>r==="pc"&&c==="pc"?"unlimited":r==="c"&&c==="c"?"dmp":`${r}-${c}`;
const palette=["#4f6f52","#665c3a","#4c6174","#6d4f62","#5e5b7a","#704e43","#3f6766","#685a41","#4f536d"];
async function load(){try{const res=await fetch("data/positions/001.json",{cache:"no-store"});if(!res.ok)throw 0;return await res.json()}catch{return FALLBACK}}
function renderTable(data){
  const table=document.getElementById("score-table"),legend=document.getElementById("legend");
  const moves=[...new Set(Object.values(data.results||{}).map(v=>v?.best).filter(Boolean))];
  const colors=new Map(moves.map((m,i)=>[m,palette[i%palette.length]]));
  let html='<thead><tr><th class="corner" aria-hidden="true"></th>'+AXES.map(a=>`<th class="white-axis">${a.html||a.label}</th>`).join('')+'</tr></thead><tbody>';
  for(const r of AXES){
    html+=`<tr><th class="black-axis">${r.html||r.label}</th>`;
    for(const c of AXES){
      if(invalid(r.key,c.key)){
        let note="";
        if(r.key==="c"&&c.key==="pc") note='<span class="invalid-label top">↑UNLIMITED</span>';
        if(r.key==="pc"&&c.key==="c") note='<span class="invalid-label bottom">↓DMP</span>';
        html+=`<td class="score-cell invalid" aria-label="not applicable">${note}</td>`;
        continue;
      }
      const k=keyFor(r.key,c.key),item=(data.results||{})[k]||{},best=item.best||"—",bg=item.best?colors.get(item.best):"";
      html+=`<td class="score-cell ${item.best?'':'empty'}" ${item.best?`data-move="${best.replace(/"/g,'&quot;')}" style="background:${bg}"`:''}><span class="move">${best}</span></td>`;
    }
    html+='</tr>';
  }
  html+='</tbody>';table.innerHTML=html;
  legend.innerHTML=moves.length?moves.map(m=>`<span class="legend-item"><span class="legend-swatch" style="background:${colors.get(m)}"></span>${m}</span>`).join(''):'';
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
