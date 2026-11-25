import * as store from './firebase-client.js';
import {key,mutation} from './data-model.js';
import {importClasses} from './timetable-format.js';

const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
export function attachTimetableImport({getState,onReload}) {
  const $=id=>document.getElementById(id),dialog=$('timetable-import-dialog');
  let drafts=[],image='',abort,epoch=0,busy=false,saving=false;
  const status=(message,error=false)=>{$('timetable-import-status').textContent=message;$('timetable-import-status').classList.toggle('dialog-error',error);};
  const selected=()=>importClasses(drafts.filter(d=>d.included));
  function validate(){
    try{
      const db={timetable:Object.fromEntries(getState().classes.map(c=>[key(c.id),{...c,meetings:Object.fromEntries((Array.isArray(c.meetings)?c.meetings:Object.values(c.meetings||{})).map(m=>[m.weekday,m]))}]))};
      const classes=selected();
      if(classes.some(c=>!c.requestedId.trim()))throw new Error('Enter a group ID for each selected class.');
      mutation(db,'importTimetable',{classes},{uuid:()=>crypto.randomUUID(),today:'',timestamp:0});
      $('timetable-import-validation').textContent=`${classes.length} new classes ready to add. Check every meeting against your image.`;
      $('timetable-import-save').disabled=busy||!getState().ready;
    }catch(e){$('timetable-import-validation').textContent=e.message;$('timetable-import-save').disabled=true;}
  }
  function field(container,label,value,onChange,{type='text',max=120,options}={}){
    const wrap=document.createElement('label');wrap.textContent=label;
    const input=document.createElement(options?'select':'input');
    if(options)for(const [v,text]of options){const o=document.createElement('option');o.value=v;o.textContent=text;input.append(o);}
    else {input.type=type;input.maxLength=max;}
    input.value=value;input.addEventListener('input',()=>{onChange(input.value);validate();});wrap.append(input);container.append(wrap);
  }
  function render(){
    const area=$('timetable-import-classes');area.replaceChildren();
    drafts.forEach((c,index)=>{
      const card=document.createElement('section');card.className='timetable-import-card';
      const heading=document.createElement('label');heading.className='timetable-import-include';
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=c.included;
      checkbox.addEventListener('change',()=>{c.included=checkbox.checked;validate();});heading.append(checkbox,document.createTextNode(`Include class ${index+1}`));card.append(heading);
      const fields=document.createElement('div');fields.className='timetable-import-fields';card.append(fields);
      field(fields,'Group ID',c.requestedId,v=>c.requestedId=v,{max:80});
      field(fields,'Class name',c.name,v=>c.name=v);field(fields,'Subject',c.subject,v=>c.subject=v);
      c.meetings.forEach((m,mi)=>{
        const row=document.createElement('div');row.className='timetable-import-meeting';card.append(row);
        field(row,'Day',m.weekday,v=>m.weekday=Number(v),{options:[[0,'Choose day'],...DAYS.map((d,i)=>[i+1,d])]});
        field(row,'Start',m.start,v=>m.start=v,{type:'time'});field(row,'End',m.end,v=>m.end=v,{type:'time'});field(row,'Room',m.room,v=>m.room=v);
        const remove=document.createElement('button');remove.type='button';remove.className='button button-quiet';remove.textContent='Remove';remove.setAttribute('aria-label',`Remove meeting ${mi+1} from class ${index+1}`);
        remove.onclick=()=>{c.meetings.splice(mi,1);render();};row.append(remove);
      });
      const add=document.createElement('button');add.type='button';add.className='button button-quiet';add.textContent='＋ Add meeting';add.onclick=()=>{c.meetings.push({weekday:0,start:'',end:'',room:''});render();};card.append(add);area.append(card);
    });
    $('timetable-import-review').hidden=!drafts.length;validate();
  }
  function reset(){epoch++;abort?.abort();abort=null;drafts=[];image='';busy=false;saving=false;$('timetable-import-file').value='';$('timetable-import-image').removeAttribute('src');$('timetable-import-image').hidden=true;$('timetable-import-read').disabled=true;$('timetable-import-file').disabled=false;$('timetable-import-review').hidden=true;$('timetable-import-classes').replaceChildren();$('timetable-import-warnings').textContent='';status('');}
  $('import-timetable-button').onclick=()=>{reset();dialog.showModal();};
  $('timetable-import-close').onclick=()=>{if(!saving)dialog.close();};
  dialog.addEventListener('cancel',e=>{if(saving)e.preventDefault();});
  dialog.addEventListener('close',()=>{if(!saving)reset();});
  store.observeAuth(()=>{if(dialog.open)dialog.close();reset();});
  $('timetable-import-file').addEventListener('change',async()=>{
    abort?.abort();const version=++epoch;drafts=[];render();image='';$('timetable-import-read').disabled=true;
    $('timetable-import-warnings').textContent='';$('timetable-import-image').hidden=true;
    const file=$('timetable-import-file').files[0];if(!file)return;
    try{
      if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024)throw new Error('Choose a PNG, JPEG or WebP image smaller than 8 MB.');
      const bitmap=await createImageBitmap(file);const pixels=bitmap.width*bitmap.height;bitmap.close();if(pixels>40000000)throw new Error('This image is too large. Crop it to the timetable first.');
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Unable to open this image.'));reader.readAsDataURL(file);});
      if(version!==epoch)return;image=data;$('timetable-import-image').src=data;$('timetable-import-image').hidden=false;$('timetable-import-read').disabled=false;status('Ready to read. Your image will be sent to DeepSeek.');
    }catch(e){if(version===epoch)status(e.message,true);}
  });
  $('timetable-import-read').onclick=async()=>{
    const user=store.currentUser();if(!user||!image||busy)return;
    const version=++epoch;abort=new AbortController();busy=true;$('timetable-import-read').disabled=true;$('timetable-import-file').disabled=true;status('Reading your timetable… This can take about a minute.');validate();
    try{
      const token=await user.getIdToken();
      if(version!==epoch)return;
      const response=await fetch('/api/timetable/extract',{method:'POST',signal:abort.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({image})});
      let data;try{data=await response.json();}catch{throw new Error('The timetable server is unavailable. Start the dashboard with its Node server.');}
      if(version!==epoch||store.currentUser()?.uid!==user.uid)return;
      if(!response.ok)throw new Error(data.error||'Unable to read this image.');
      const subject=$('timetable-import-subject').value.trim();
      drafts=data.classes.map(c=>({...c,subject:c.subject||subject,included:true}));
      $('timetable-import-warnings').textContent=(data.warnings||[]).join('\n');render();
      status(drafts.length?'Review and correct the extracted timetable below. Nothing has been saved yet.':'No timetable was found. Try a clearer image or crop it to one teacher’s timetable.');
    }catch(e){if(version===epoch&&e.name!=='AbortError')status(e.message,true);}
    finally{if(version===epoch){busy=false;$('timetable-import-read').disabled=!image;$('timetable-import-file').disabled=false;validate();}}
  };
  $('timetable-import-save').onclick=async()=>{
    if(busy||$('timetable-import-save').disabled)return;
    validate();if($('timetable-import-save').disabled)return;
    const uid=store.currentUser()?.uid,version=epoch;if(!uid)return;
    busy=true;saving=true;$('timetable-import-save').disabled=true;$('timetable-import-close').disabled=true;$('timetable-import-read').disabled=true;$('timetable-import-file').disabled=true;
    $('timetable-import-classes').inert=true;getState().pending=true;status('Saving your timetable…');
    try{
      await store.request('importTimetable',{token:uid,classes:selected()});
      if(version!==epoch||store.currentUser()?.uid!==uid)return;
      getState().pending=false;await onReload();saving=false;dialog.close();
    }catch(e){if(version===epoch)status(e.message,true);}
    finally{if(version===epoch){busy=false;saving=false;getState().pending=false;$('timetable-import-read').disabled=!image;$('timetable-import-file').disabled=false;validate();}$('timetable-import-close').disabled=false;$('timetable-import-classes').inert=false;}
  };
}
