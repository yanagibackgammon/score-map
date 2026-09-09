"use strict";
const zone=document.getElementById('drop-zone');
const input=document.getElementById('file-input');
const info=document.getElementById('file-info');
const button=document.getElementById('preview-button');
const status=document.getElementById('import-status');
const titleInput=document.getElementById('title-input');
let selectedFile=null;

function showStatus(message,isError=false){status.hidden=false;status.textContent=message;status.style.color=isError?'#a12622':''}
function setFile(file){
  if(!file)return;
  const ext=file.name.toLowerCase().split('.').pop();
  if(!['xg','xgp'].includes(ext)){
    selectedFile=null;info.textContent='XG / XGP';button.disabled=true;showStatus('XG / XGPを選択してください。',true);return;
  }
  selectedFile=file;
  info.textContent=`${file.name} / ${(file.size/1024).toFixed(1)} KB`;
  button.disabled=false;
  status.hidden=true;
}
function download(bytes,name){
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));
  const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

zone.addEventListener('click',()=>input.click());
zone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click()}});
input.addEventListener('change',()=>setFile(input.files[0]));
['dragenter','dragover'].forEach(t=>zone.addEventListener(t,e=>{e.preventDefault();zone.classList.add('is-dragging')}));
['dragleave','drop'].forEach(t=>zone.addEventListener(t,e=>{e.preventDefault();zone.classList.remove('is-dragging')}));
zone.addEventListener('drop',e=>setFile(e.dataTransfer.files[0]));

button.addEventListener('click',async()=>{
  if(!selectedFile)return;
  button.disabled=true;
  showStatus('生成中…');
  try{
    const source=await selectedFile.arrayBuffer();
    const result=await ScoreMapXGBatch.generateBatch(source,{title:titleInput.value});
    download(result.zip,'score-map-34-xgp.zip');
    showStatus('34 XGP');
  }catch(error){
    console.error(error);showStatus(error?.message||'生成に失敗しました。',true);
  }finally{button.disabled=false}
});
