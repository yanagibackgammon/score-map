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
      try{
        await navigator.clipboard.writeText(button.dataset.xgid);
        button.classList.add('copied');
        button.setAttribute('title','コピーしました');
        setTimeout(()=>{button.classList.remove('copied');button.setAttribute('title','XGIDをコピー')},900);
      }catch{
        const ta=document.createElement('textarea');ta.value=button.dataset.xgid;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();
        button.classList.add('copied');setTimeout(()=>button.classList.remove('copied'),900);
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
  analyzedInfo.textContent=generatedPlan?`${analyzedFiles.length} / ${required}`:'解析用XGIDを先に作成してください';
  jsonButton.disabled=!(generatedPlan&&required>0&&analyzedFiles.length===required);
}
function finalJsonText(){
  if(!generatedData)return '';
  const data=structuredClone(generatedData);data.title=titleInput.value.trim();
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
  if(files.length&&generatedPlan&&analyzedFiles.length!==generatedPlan.eligibleCount){
    showStatus(jsonStatus,`①で解析対象になった${generatedPlan.eligibleCount}ファイルをまとめて選択してください。`,true);
  }
});

jsonButton.addEventListener('click',async()=>{
  if(!generatedPlan||analyzedFiles.length!==generatedPlan.eligibleCount)return;
  jsonButton.disabled=true;showStatus(jsonStatus,'ダブルアクション解析結果を読み取っています…');
  try{
    const inputs=[];
    for(const file of analyzedFiles)inputs.push({name:file.name,buffer:await file.arrayBuffer()});
    generatedData=await ScoreMapXGBatch.buildScoreMapJson(inputs,{title:'',plan:generatedPlan});
    generatedData.title='';refreshFinalState();
    showStatus(jsonStatus,`${generatedPlan.eligibleCount}件の解析結果を読み込み、除外条件をNo Doubleで補完してJSONを生成しました。`);
  }catch(error){console.error(error);generatedData=null;jsonPreview.value='';downloadJsonButton.disabled=true;publishButton.disabled=true;showStatus(jsonStatus,error?.message||'JSON生成に失敗しました。',true)}
  finally{updateAnalyzedState()}
});

titleInput.addEventListener('input',refreshFinalState);
downloadJsonButton.addEventListener('click',()=>{const text=finalJsonText();if(text)downloadBlob(text,'001.json','application/json;charset=utf-8')});
tokenInput.addEventListener('input',refreshFinalState);

function base64Utf8(text){
  const bytes=new TextEncoder().encode(text);let bin='';const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)bin+=String.fromCharCode(...bytes.subarray(i,i+chunk));
  return btoa(bin);
}
async function githubRequest(url,options={}){
  const token=tokenInput.value.trim();
  const headers={'Accept':'application/vnd.github+json','Authorization':`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28',...(options.headers||{})};
  const res=await fetch(url,{...options,headers});
  if(!res.ok){let detail='';try{const body=await res.json();detail=body?.message||''}catch{}const err=new Error(`GitHub API ${res.status}${detail?`: ${detail}`:''}`);err.status=res.status;throw err}
  return res.status===204?null:res.json();
}

publishButton.addEventListener('click',async()=>{
  const generatedJson=finalJsonText();if(!generatedJson||!tokenInput.value.trim())return;
  publishButton.disabled=true;publicLink.hidden=true;showStatus(publishStatus,'GitHubへ反映しています…');
  const api='https://api.github.com/repos/yanagibackgammon/score-map/contents/data/positions/001.json';
  try{
    let sha=null;try{const current=await githubRequest(`${api}?ref=main`);sha=current?.sha||null}catch(error){if(error.status!==404)throw error}
    const body={message:'Update Score Map position data',content:base64Utf8(generatedJson),branch:'main'};if(sha)body.sha=sha;
    await githubRequest(api,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    showStatus(publishStatus,'GitHubへ反映しました。PagesはActionsで自動更新されます。');publicLink.hidden=false;
  }catch(error){console.error(error);showStatus(publishStatus,error?.message||'GitHubへの反映に失敗しました。',true)}
  finally{refreshFinalState()}
});
