"use strict";

const AXES=["PC","C","2a","3a","4a","5a"];
const xgidInput=document.getElementById('xgid-input');
const xgidInfo=document.getElementById('xgid-info');
const xgidButton=document.getElementById('xgid-generate-button');
const xgidStatus=document.getElementById('xgid-status');
const xgidTable=document.getElementById('xgid-score-table');
const xgidSummary=document.getElementById('xgid-map-summary');

const analyzedZone=document.getElementById('analyzed-zone');
const analyzedInput=document.getElementById('analyzed-input');
const analyzedInfo=document.getElementById('analyzed-info');
const jsonButton=document.getElementById('json-button');
const jsonStatus=document.getElementById('json-status');
const jsonPreview=document.getElementById('json-preview');

const titleInput=document.getElementById('title-input');
const downloadJsonButton=document.getElementById('download-json-button');
const tokenInput=document.getElementById('github-token');
const publishButton=document.getElementById('publish-button');
const publishStatus=document.getElementById('publish-status');
const publicLink=document.getElementById('public-link');

let generatedPlan=null;
let analyzedFiles=[];
let generatedData=null;

function showStatus(el,message,isError=false){
  el.hidden=false;el.textContent=message;el.classList.toggle('is-error',!!isError);
}
function clearStatus(el){el.hidden=true;el.textContent='';el.classList.remove('is-error')}
function isAnalyzedFile(file){return /\.(xg|xgp)$/i.test(file?.name||'')}
function downloadBlob(content,name,type='application/octet-stream'){
  const url=URL.createObjectURL(new Blob([content],{type}));
  const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function wireDrop(zone,input,onFiles){
  zone.addEventListener('click',()=>input.click());
  zone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click()}});
  input.addEventListener('change',()=>onFiles([...input.files]));
  ['dragenter','dragover'].forEach(t=>zone.addEventListener(t,e=>{e.preventDefault();zone.classList.add('is-dragging')}));
  ['dragleave','drop'].forEach(t=>zone.addEventListener(t,e=>{e.preventDefault();zone.classList.remove('is-dragging')}));
  zone.addEventListener('drop',e=>onFiles([...e.dataTransfer.files]));
}
function keyFor(r,c){
  if(r==='PC'&&c==='PC')return 'unlimited';
  if(r==='C'&&c==='C')return 'dmp';
  const n=x=>x==='PC'?'pc':x==='C'?'c':x.replace('a','');
  return `${n(r)}-${n(c)}`;
}
function isInvalid(r,c){return (r==='PC'&&c==='C')||(r==='C'&&c==='PC')}
function copySvg(){
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="10" height="11" rx="1.5"></rect><path d="M6 16H5.5A1.5 1.5 0 0 1 4 14.5v-9A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5V6"></path></svg>';
}
function renderXgidTable(plan){
  const byKey=new Map(plan.items.map(item=>[item.key,item]));
  let html='<thead><tr><th class="xgid-corner"></th>'+AXES.map(x=>`<th class="xgid-white-axis">${x}</th>`).join('')+'</tr></thead><tbody>';
  for(const r of AXES){
    html+=`<tr><th class="xgid-black-axis">${r}</th>`;
    for(const c of AXES){
      if(isInvalid(r,c)){
        html+='<td class="xgid-cell invalid" aria-label="対象外"></td>';
        continue;
      }
      const item=byKey.get(keyFor(r,c));
      if(item?.eligible){
        const safe=item.xgid.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
        html+=`<td class="xgid-cell"><button class="xgid-copy" type="button" data-xgid="${safe}" aria-label="${r} × ${c} のXGIDをコピー" title="XGIDをコピー">${copySvg()}</button></td>`;
      }else{
        const reason=(item?.reason||'対象外').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
        html+=`<td class="xgid-cell excluded" title="${reason}" aria-label="${reason}"><span>—</span></td>`;
      }
    }
    html+='</tr>';
  }
  html+='</tbody>';
  xgidTable.innerHTML=html;
  xgidTable.querySelectorAll('.xgid-copy').forEach(button=>{
    button.addEventListener('click',async()=>{
      const markCopied=()=>{
        button.classList.add('copied');
        button.closest('.xgid-cell')?.classList.add('is-copied');
        button.setAttribute('title','コピー済み');
        button.setAttribute('aria-label',button.getAttribute('aria-label').replace('をコピー','（コピー済み）'));
      };
      try{
        await navigator.clipboard.writeText(button.dataset.xgid);
        markCopied();
      }catch{
        const ta=document.createElement('textarea');ta.value=button.dataset.xgid;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();
        markCopied();
      }
    });
  });
}
function resetAfterPlan(){
  analyzedFiles=[];analyzedInput.value='';generatedData=null;jsonPreview.value='';
  downloadJsonButton.disabled=true;publishButton.disabled=true;publicLink.hidden=true;
  clearStatus(jsonStatus);clearStatus(publishStatus);
}
function updateAnalyzedState(){
  const required=generatedPlan?.eligibleCount||0;
  analyzedInfo.textContent=generatedPlan?`${analyzedFiles.length} / 最大 ${required}`:'解析用XGIDを先に作成してください';
  jsonButton.disabled=!(generatedPlan&&required>0&&analyzedFiles.length>0&&analyzedFiles.length<=required);
}
function finalJsonText(id=''){
  if(!generatedData)return '';
  const data=structuredClone(generatedData);
  data.id=String(id||data.id||'');
  data.title=titleInput.value.trim();
  return JSON.stringify(data,null,2)+'\n';
}
function refreshFinalState(){
  if(generatedData)jsonPreview.value=finalJsonText();
  downloadJsonButton.disabled=!generatedData;
  publishButton.disabled=!(generatedData&&tokenInput.value.trim());
}

xgidInput.addEventListener('input',()=>{
  generatedPlan=null;resetAfterPlan();xgidTable.innerHTML='';xgidSummary.textContent='XGIDを入力してください。';
  const value=xgidInput.value.trim();
  if(!value){xgidInfo.textContent='未入力';xgidButton.disabled=true;return}
  try{
    const x=ScoreMapXGBatch.parseXgid(value);
    const cubeValue=Math.pow(2,Math.max(0,x.cubeExp));
    const owner=x.cubePos===0?'CENTER':x.cubePos>0?'自分':'相手';
    xgidInfo.textContent=`XGID確認済み / Cube ${cubeValue} / ${owner}`;
    xgidButton.disabled=false;clearStatus(xgidStatus);
  }catch(error){xgidInfo.textContent='形式を確認してください';xgidButton.disabled=true}
});

xgidButton.addEventListener('click',()=>{
  try{
    generatedPlan=ScoreMapXGBatch.generateScoreXgids(xgidInput.value.trim());
    resetAfterPlan();renderXgidTable(generatedPlan);updateAnalyzedState();
    xgidSummary.textContent=`解析対象 ${generatedPlan.eligibleCount}件 / 除外 ${generatedPlan.excludedCount}件　※UnlimitedはJacobyなし・Beaverなしで生成`;
    showStatus(xgidStatus,'各セルのコピーアイコンからXGIDをコピーし、XG2でDouble Actionを解析してください。');
  }catch(error){console.error(error);generatedPlan=null;showStatus(xgidStatus,error?.message||'XGID生成に失敗しました。',true)}
});

wireDrop(analyzedZone,analyzedInput,files=>{
  analyzedFiles=files.filter(isAnalyzedFile);
  generatedData=null;jsonPreview.value='';downloadJsonButton.disabled=true;publishButton.disabled=true;publicLink.hidden=true;
  clearStatus(jsonStatus);clearStatus(publishStatus);updateAnalyzedState();
  if(files.length&&generatedPlan&&analyzedFiles.length>generatedPlan.eligibleCount){
    showStatus(jsonStatus,`①の解析対象は最大${generatedPlan.eligibleCount}件です。対象ファイルだけを選択してください。`,true);
  }
});

jsonButton.addEventListener('click',async()=>{
  if(!generatedPlan||analyzedFiles.length<1||analyzedFiles.length>generatedPlan.eligibleCount)return;
  jsonButton.disabled=true;showStatus(jsonStatus,'ダブルアクション解析結果を読み取っています…');
  try{
    const inputs=[];
    for(const file of analyzedFiles)inputs.push({name:file.name,buffer:await file.arrayBuffer()});
    generatedData=await ScoreMapXGBatch.buildScoreMapJson(inputs,{title:'',plan:generatedPlan});
    generatedData.title='';refreshFinalState();
    showStatus(jsonStatus,`${analyzedFiles.length}件の解析結果だけでJSONを生成しました。未入力・解析対象外のスコアは空欄のままです。`);
  }catch(error){console.error(error);generatedData=null;jsonPreview.value='';downloadJsonButton.disabled=true;publishButton.disabled=true;showStatus(jsonStatus,error?.message||'JSON生成に失敗しました。',true)}
  finally{updateAnalyzedState()}
});

titleInput.addEventListener('input',refreshFinalState);
downloadJsonButton.addEventListener('click',()=>{
  const text=finalJsonText();if(!text)return;
  const d=new Date(),pad=n=>String(n).padStart(2,'0');
  const stamp=`${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  downloadBlob(text,`score-map_${stamp}.json`,'application/json;charset=utf-8');
});
tokenInput.addEventListener('input',refreshFinalState);

function base64Utf8(text){
  const bytes=new TextEncoder().encode(text);let bin='';const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)bin+=String.fromCharCode(...bytes.subarray(i,i+chunk));
  return btoa(bin);
}
function decodeBase64Utf8(value){
  const bin=atob(String(value||'').replace(/\s+/g,''));
  const bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
async function githubRequest(url,options={}){
  const token=tokenInput.value.trim();
  const headers={'Accept':'application/vnd.github+json','Authorization':`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28',...(options.headers||{})};
  const res=await fetch(url,{...options,headers});
  if(!res.ok){let detail='';try{const body=await res.json();detail=body?.message||''}catch{}const err=new Error(`GitHub API ${res.status}${detail?`: ${detail}`:''}`);err.status=res.status;throw err}
  return res.status===204?null:res.json();
}
function manifestEntryFromPosition(data,id){
  return {id:String(id),title:String(data?.title||'').trim(),generatedAt:String(data?.generatedAt||new Date().toISOString())};
}
async function loadPublishManifest(){
  const base='https://api.github.com/repos/yanagibackgammon/score-map/contents/data/positions';
  try{
    const current=await githubRequest(`${base}/index.json?ref=main`);
    const parsed=JSON.parse(decodeBase64Utf8(current.content));
    return {data:{schemaVersion:1,positions:Array.isArray(parsed?.positions)?parsed.positions:[]},sha:current.sha||null,exists:true};
  }catch(error){
    if(error.status!==404)throw error;
  }
  const positions=[];
  // v23 and earlier used only 001.json. Bring it into the first manifest automatically.
  try{
    const first=await githubRequest(`${base}/001.json?ref=main`);
    const data=JSON.parse(decodeBase64Utf8(first.content));
    positions.push(manifestEntryFromPosition(data,'001'));
  }catch(error){if(error.status!==404)throw error}
  return {data:{schemaVersion:1,positions},sha:null,exists:false};
}
function nextPositionNumber(positions){
  const nums=positions.map(x=>Number.parseInt(x?.id,10)).filter(Number.isFinite);
  return (nums.length?Math.max(...nums):0)+1;
}
async function findAvailableId(startNumber){
  const base='https://api.github.com/repos/yanagibackgammon/score-map/contents/data/positions';
  let n=startNumber;
  for(let attempts=0;attempts<1000;attempts++,n++){
    const id=String(n).padStart(3,'0');
    try{await githubRequest(`${base}/${id}.json?ref=main`)}catch(error){if(error.status===404)return id;throw error}
  }
  throw new Error('空きIDを取得できませんでした。');
}

publishButton.addEventListener('click',async()=>{
  if(!generatedData||!tokenInput.value.trim())return;
  publishButton.disabled=true;publicLink.hidden=true;showStatus(publishStatus,'新しいポジションとしてGitHubへ追加しています…');
  const base='https://api.github.com/repos/yanagibackgammon/score-map/contents/data/positions';
  try{
    const manifest=await loadPublishManifest();
    const id=await findAvailableId(nextPositionNumber(manifest.data.positions));
    const positionText=finalJsonText(id);
    const positionData=JSON.parse(positionText);
    const createBody={message:`Add Score Map position ${id}`,content:base64Utf8(positionText),branch:'main'};
    await githubRequest(`${base}/${id}.json`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(createBody)});

    const entries=[...manifest.data.positions.filter(x=>String(x?.id)!==id),manifestEntryFromPosition(positionData,id)]
      .sort((a,b)=>(Number.parseInt(a.id,10)||0)-(Number.parseInt(b.id,10)||0));
    const manifestData={schemaVersion:1,updatedAt:new Date().toISOString(),positions:entries};
    const manifestBody={message:`Update Score Map index for ${id}`,content:base64Utf8(JSON.stringify(manifestData,null,2)+'\n'),branch:'main'};
    if(manifest.sha)manifestBody.sha=manifest.sha;
    await githubRequest(`${base}/index.json`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(manifestBody)});

    generatedData.id=id;
    jsonPreview.value=finalJsonText(id);
    publicLink.href=`position.html?id=${encodeURIComponent(id)}`;
    publicLink.textContent='追加したページを開く';
    publicLink.hidden=false;
    showStatus(publishStatus,`${id}.jsonとして追加しました。一覧ページにも1行追加されます。PagesはActionsで自動更新されます。`);
  }catch(error){console.error(error);showStatus(publishStatus,error?.message||'GitHubへの反映に失敗しました。',true)}
  finally{refreshFinalState()}
});
