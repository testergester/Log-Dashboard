import * as store from './firebase-client.js';
import {parseStudentPaste,planStudentImport,groupLabelKey} from './student-import-model.js';

export function attachStudentImport({getState,onReload,onNotice,beforeOpen=()=>{}}){
  const $=id=>document.getElementById(id),dialog=$('student-import-dialog');
  let rows=[],mapping=Object.create(null),busy=false,epoch=0;
  const status=(text,error=false)=>{$('student-import-status').textContent=text;$('student-import-status').classList.toggle('dialog-error',error);};
  const label=c=>c.name+' · '+c.subject+(c.id!==c.name?' ['+c.id+']':'');
  const options=select=>{select.replaceChildren(new Option('Choose a class',''));for(const c of getState().classes.filter(c=>c.active))select.add(new Option(label(c),c.id));};
  const plan=()=>planStudentImport(rows,{...getState(),defaultClassId:$('student-import-default').value,mapping});
  function update(){
    const result=plan();let ready=0,duplicates=0,errors=0,excluded=0;
    result.forEach((row,i)=>{
      if(row.status==='ready')ready++;else if(row.status==='duplicate')duplicates++;else if(row.status==='error')errors++;else excluded++;
      const cell=$('student-import-rows').children[i]?.querySelector('.student-import-row-status');
      if(cell){cell.textContent=row.message;cell.classList.toggle('dialog-error',row.status==='error');}
    });
    $('student-import-summary').textContent=`${ready} to add · ${duplicates} duplicates skipped · ${errors} need correction · ${excluded} excluded`;
    $('student-import-save').disabled=busy||!ready||errors>0||!getState().ready;
    return result;
  }
  function render(){
    const body=$('student-import-rows');body.replaceChildren();
    rows.forEach((row,i)=>{
      const tr=document.createElement('tr'),includeCell=document.createElement('td'),nameCell=document.createElement('td'),groupCell=document.createElement('td'),resultCell=document.createElement('td');
      const include=document.createElement('input');include.type='checkbox';include.checked=row.included;include.setAttribute('aria-label',`Include student ${i+1}`);include.onchange=()=>{row.included=include.checked;update();};includeCell.append(include);
      const name=document.createElement('input');name.type='text';name.value=row.name;name.maxLength=120;name.setAttribute('aria-label',`Full name for row ${i+1}`);name.oninput=()=>{row.name=name.value;update();};nameCell.append(name);
      groupCell.textContent=row.group||'Default class';resultCell.className='student-import-row-status';
      tr.append(includeCell,nameCell,groupCell,resultCell);body.append(tr);
    });
    const groups=$('student-import-groups');groups.replaceChildren();
    const inferred=planStudentImport(rows,getState());
    for(const token of new Set(rows.map(r=>groupLabelKey(r.group)).filter(Boolean))){
      const wrap=document.createElement('label');wrap.textContent='Group '+rows.find(r=>groupLabelKey(r.group)===token).group;
      const select=document.createElement('select');options(select);
      const suggested=inferred.find(r=>groupLabelKey(r.group)===token)?.classId||'';
      select.value=Object.hasOwn(mapping,token)?mapping[token]:suggested;
      select.onchange=()=>{mapping[token]=select.value;update();};wrap.append(select);groups.append(wrap);
    }
    $('student-import-preview').hidden=!rows.length;update();
  }
  function reset(){epoch++;rows=[];mapping=Object.create(null);busy=false;$('student-import-source').value='';$('student-import-save').disabled=true;$('student-import-preview').hidden=true;$('student-import-rows').replaceChildren();$('student-import-groups').replaceChildren();$('student-import-edit').inert=false;$('student-import-close').disabled=false;status('');}
  function open(classId=''){
    if(!getState().ready||getState().pending)return;
    beforeOpen();reset();options($('student-import-default'));$('student-import-default').value=classId;
    document.querySelector('#student-dialog')?.close();dialog.showModal();$('student-import-source').focus();
  }
  $('bulk-students-button').onclick=()=>open();
  $('bulk-class-students-button').onclick=()=>open(getState().selectedClassId);
  $('student-dialog-bulk').onclick=()=>open(getState().selectedClassId);
  $('student-import-close').onclick=()=>{if(!busy)dialog.close();};
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close',()=>{if(!busy)reset();});
  store.observeAuth(()=>{dialog.close();reset();});
  $('student-import-default').onchange=()=>{if(rows.length)update();};
  $('student-import-source').oninput=()=>{rows=[];$('student-import-preview').hidden=true;$('student-import-save').disabled=true;status('Paste updated. Click Review students to check it.');};
  $('student-import-parse').onclick=()=>{
    try{rows=parseStudentPaste($('student-import-source').value);mapping=Object.create(null);render();status(rows.length?'Review the class mappings and students below. Nothing has been saved yet.':'Paste a student list first.',!rows.length);}catch(e){rows=[];$('student-import-preview').hidden=true;$('student-import-save').disabled=true;status(e.message,true);}
  };
  $('student-import-save').onclick=async()=>{
    if(busy||getState().pending)return;
    const result=update();if($('student-import-save').disabled)return;
    const students=result.filter(r=>r.status==='ready').map(r=>({name:r.name.trim(),classId:r.classId}));
    const uid=store.currentUser()?.uid,version=epoch;if(!uid)return;
    busy=true;getState().pending=true;$('student-import-save').disabled=true;$('student-import-close').disabled=true;$('student-import-edit').inert=true;status('Adding students to their official groups…');
    try{
      await store.request('importStudents',{token:uid,students});
      if(version!==epoch||store.currentUser()?.uid!==uid)return;
      getState().pending=false;await onReload();
      if(version!==epoch||store.currentUser()?.uid!==uid)return;
      busy=false;dialog.close();onNotice('Bulk student import completed. Your class rosters are updated.');
    }catch(e){if(version===epoch)status(e.message,true);}
    finally{if(version===epoch){busy=false;getState().pending=false;$('student-import-close').disabled=false;$('student-import-edit').inert=false;update();}}
  };
}
