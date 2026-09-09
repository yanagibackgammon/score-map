"use strict";
const sourceZone=document.getElementById('drop-zone');
const sourceInput=document.getElementById('file-input');
const sourceInfo=document.getElementById('file-info');
const batchButton=document.getElementById('batch-button');
const batchStatus=document.getElementById('batch-status');
const titleInput=document.getElementById('title-input');

const analyzedZone=document.getElementById('analyzed-zone');
const analyzedInput=document.getElementById('analyzed-input');
const analyzedInfo=document.getElementById('analyzed-info');
const jsonButton=document.getElementById('json-button');
const jsonStatus=document.getElementById('json-status');
const jsonPreview=document.getElementById('json-preview');
const downloadJsonButton=document.getElementById('download-json-button');

const tokenInput=document.getElementById('github-token');
const publishButton=document.getElementById('publish-button');
const publishStatus=document.getElementById('publish-status');
const publicLink=document.getElementById('public-link');

let sourceFile=null;
let analyzedFiles=[];
let generatedJson='';

function showStatus(el,message,isError=false){
  el.hidden=false;el.textContent=message;el.classList.toggle('is-error',!!isError);
}
function clearStatus(el){el.hidden=true;el.textContent='';el.classList.remove('is-error')}
function isXgFile(file){return /\.(xg|xgp)$/i.test(file?.name||'')}
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

wireDrop(sourceZone,sourceInput,files=>{
  const file=files[0];
  if(!isXgFile(file)){
    sourceFile=null;sourceInfo.textContent='未選択';batchButton.disabled=true;showStatus(batchStatus,'XG / XGPを1ファイル選択してください。',true);return;
  }
  sourceFile=file;sourceInfo.textContent=`${file.name} / ${(file.size/1024).toFixed(1)} KB`;batchButton.disabled=false;clearStatus(batchStatus);
});

batchButton.addEventListener('click',async()=>{
  if(!sourceFile)return;
  batchButton.disabled=true;showStatus(batchStatus,'34条件を生成しています…');
  try{
    const result=await ScoreMapXGBatch.generateBatch(await sourceFile.arrayBuffer(),{title:titleInput.value});
    downloadBlob(result.zip,'score-map-34-xgp.zip','application/zip');
    showStatus(batchStatus,'34個の解析用XGPをZIPで出力しました。');
  }catch(error){console.error(error);showStatus(batchStatus,error?.message||'生成に失敗しました。',true)}
  finally{batchButton.disabled=false}
});

wireDrop(analyzedZone,analyzedInput,files=>{
  analyzedFiles=files.filter(isXgFile);
  analyzedInfo.textContent=`${analyzedFiles.length} / 34`;
  const ok=analyzedFiles.length===34;
  jsonButton.disabled=!ok;
  generatedJson='';jsonPreview.value='';downloadJsonButton.disabled=true;publishButton.disabled=true;publicLink.hidden=true;
  clearStatus(jsonStatus);clearStatus(publishStatus);
  if(files.length && !ok)showStatus(jsonStatus,'解析済みXGPを34個まとめて選択してください。',true);
});

jsonButton.addEventListener('click',async()=>{
  if(analyzedFiles.length!==34)return;
  jsonButton.disabled=true;showStatus(jsonStatus,'34ファイルの解析結果を読み取っています…');
  try{
    const inputs=[];
    for(const file of analyzedFiles)inputs.push({name:file.name,buffer:await file.arrayBuffer()});
    const data=await ScoreMapXGBatch.buildScoreMapJson(inputs,{title:titleInput.value});
    generatedJson=JSON.stringify(data,null,2)+'\n';
    jsonPreview.value=generatedJson;
    if(!titleInput.value.trim() && data.title)titleInput.value=data.title;
    downloadJsonButton.disabled=false;
    publishButton.disabled=!tokenInput.value.trim();
    showStatus(jsonStatus,'34 / 34 の解析結果からJSONを生成しました。');
  }catch(error){console.error(error);generatedJson='';jsonPreview.value='';downloadJsonButton.disabled=true;publishButton.disabled=true;showStatus(jsonStatus,error?.message||'JSON生成に失敗しました。',true)}
  finally{jsonButton.disabled=analyzedFiles.length!==34?true:false}
});

downloadJsonButton.addEventListener('click',()=>{if(generatedJson)downloadBlob(generatedJson,'001.json','application/json;charset=utf-8')});
tokenInput.addEventListener('input',()=>{publishButton.disabled=!(generatedJson&&tokenInput.value.trim())});

function base64Utf8(text){
  const bytes=new TextEncoder().encode(text);let bin='';const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)bin+=String.fromCharCode(...bytes.subarray(i,i+chunk));
  return btoa(bin);
}
async function githubRequest(url,options={}){
  const token=tokenInput.value.trim();
  const headers={
    'Accept':'application/vnd.github+json',
    'Authorization':`Bearer ${token}`,
    'X-GitHub-Api-Version':'2026-03-10',
    ...(options.headers||{})
  };
  const res=await fetch(url,{...options,headers});
  if(!res.ok){
    let detail='';try{const body=await res.json();detail=body?.message||''}catch{}
    const err=new Error(`GitHub API ${res.status}${detail?`: ${detail}`:''}`);err.status=res.status;throw err;
  }
  return res.status===204?null:res.json();
}

publishButton.addEventListener('click',async()=>{
  if(!generatedJson||!tokenInput.value.trim())return;
  publishButton.disabled=true;publicLink.hidden=true;showStatus(publishStatus,'GitHubへ反映しています…');
  const api='https://api.github.com/repos/yanagibackgammon/score-map/contents/data/positions/001.json';
  try{
    let sha=null;
    try{const current=await githubRequest(`${api}?ref=main`);sha=current?.sha||null}catch(error){if(error.status!==404)throw error}
    const body={message:'Update Score Map position data',content:base64Utf8(generatedJson),branch:'main'};
    if(sha)body.sha=sha;
    await githubRequest(api,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    showStatus(publishStatus,'GitHubへ反映しました。PagesはActionsで自動更新されます。');
    publicLink.hidden=false;
  }catch(error){console.error(error);showStatus(publishStatus,error?.message||'GitHubへの反映に失敗しました。',true)}
  finally{publishButton.disabled=!(generatedJson&&tokenInput.value.trim())}
});
