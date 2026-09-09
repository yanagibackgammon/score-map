"use strict";
const sourceZone=document.getElementById('drop-zone');
const sourceInput=document.getElementById('file-input');
const sourceInfo=document.getElementById('file-info');
const xgidInput=document.getElementById('xgid-input');
const xgidInfo=document.getElementById('xgid-info');
const batchButton=document.getElementById('batch-button');
const batchStatus=document.getElementById('batch-status');

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

let sourceFile=null;
let analyzedFiles=[];
let generatedData=null;

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
function sourceReady(){if(sourceFile)return true;const value=xgidInput.value.trim();if(!value)return false;try{ScoreMapXGBatch.parseXgid(value);return true}catch{return false}}
function refreshBatchState(){batchButton.disabled=!sourceReady()}
function finalJsonText(){
  if(!generatedData)return '';
  const data=structuredClone(generatedData);
  data.title=titleInput.value.trim();
  return JSON.stringify(data,null,2)+'\n';
}
function refreshFinalState(){
  if(generatedData)jsonPreview.value=finalJsonText();
  downloadJsonButton.disabled=!generatedData;
  publishButton.disabled=!(generatedData&&tokenInput.value.trim());
}

wireDrop(sourceZone,sourceInput,files=>{
  const file=files[0];
  if(!isXgFile(file)){
    sourceFile=null;sourceInfo.textContent='未選択';showStatus(batchStatus,'XG / XGPを1ファイル選択してください。',true);refreshBatchState();return;
  }
  sourceFile=file;
  sourceInfo.textContent=`${file.name} / ${(file.size/1024).toFixed(1)} KB`;
  xgidInput.value='';xgidInfo.textContent='未入力';
  clearStatus(batchStatus);refreshBatchState();
});

xgidInput.addEventListener('input',()=>{
  const value=xgidInput.value.trim();
  if(value){
    sourceFile=null;sourceInput.value='';sourceInfo.textContent='未選択';
    try{const x=ScoreMapXGBatch.parseXgid(value);xgidInfo.textContent=`XGID確認済み / ${x.diceText==='00'?'キューブ判断':`出目 ${x.diceText}`}`;clearStatus(batchStatus)}
    catch(error){xgidInfo.textContent='形式を確認してください';}
  }else{xgidInfo.textContent='未入力'}
  refreshBatchState();
});

batchButton.addEventListener('click',async()=>{
  if(!sourceReady())return;
  batchButton.disabled=true;showStatus(batchStatus,'34条件を生成しています…');
  try{
    const source=sourceFile ? await sourceFile.arrayBuffer() : xgidInput.value.trim();
    const result=await ScoreMapXGBatch.generateBatch(source);
    downloadBlob(result.zip,'score-map-analysis-set.zip','application/zip');
    showStatus(batchStatus,'解析用XGセットを出力しました。XG2のBatch Analyzeで2ファイルをまとめて解析してください。');
  }catch(error){console.error(error);showStatus(batchStatus,error?.message||'生成に失敗しました。',true)}
  finally{refreshBatchState()}
});

wireDrop(analyzedZone,analyzedInput,files=>{
  analyzedFiles=files.filter(isXgFile);
  analyzedInfo.textContent=`${analyzedFiles.length} / 2`;
  const ok=analyzedFiles.length===2;
  jsonButton.disabled=!ok;
  generatedData=null;jsonPreview.value='';downloadJsonButton.disabled=true;publishButton.disabled=true;publicLink.hidden=true;
  clearStatus(jsonStatus);clearStatus(publishStatus);
  if(files.length && !ok)showStatus(jsonStatus,'解析済みXGを2ファイルまとめて選択してください。',true);
});

jsonButton.addEventListener('click',async()=>{
  if(analyzedFiles.length!==2)return;
  jsonButton.disabled=true;showStatus(jsonStatus,'2ファイルから34条件の解析結果を読み取っています…');
  try{
    const inputs=[];
    for(const file of analyzedFiles)inputs.push({name:file.name,buffer:await file.arrayBuffer()});
    generatedData=await ScoreMapXGBatch.buildScoreMapJson(inputs,{title:''});
    generatedData.title='';
    refreshFinalState();
    showStatus(jsonStatus,'34 / 34 の解析結果からJSONを生成しました。③でタイトルを設定してください。');
  }catch(error){console.error(error);generatedData=null;jsonPreview.value='';downloadJsonButton.disabled=true;publishButton.disabled=true;showStatus(jsonStatus,error?.message||'JSON生成に失敗しました。',true)}
  finally{jsonButton.disabled=analyzedFiles.length!==2}
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
  const generatedJson=finalJsonText();
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
  finally{refreshFinalState()}
});
