import * as store from './firebase-client.js';
export function attachArchives({getData,onReload,onError}){
  const dialog=document.querySelector('#archives-dialog'),list=document.querySelector('#archives-list'),status=document.querySelector('#archives-status');
  document.querySelector('#archives-close').addEventListener('click',()=>dialog.close());
  async function render(){
    const data=getData();list.replaceChildren();status.textContent='Archived records stay in your account. Restoring keeps their original identifiers.';
    const rows=[...(data.classes||[]).filter(c=>!c.active).map(c=>({label:'Class · '+c.name,action:'restoreClass',fields:{classId:c.id},revision:c.revision})),
      ...(data.archivedStudents||[]).map(s=>({label:'Student · '+s.name,action:'restoreStudent',fields:{studentId:s.id},revision:s.revision})),
      ...(data.archivedLogs||[]).map(l=>({label:'Lesson · '+l.className+' · '+l.date,action:'restoreLog',fields:{classId:l.classId,date:l.date},revision:l.revision}))];
    if(!rows.length){const p=document.createElement('p');p.textContent='No archived records in the loaded date range.';list.append(p);}
    for(const row of rows){const item=document.createElement('div'),label=document.createElement('span'),button=document.createElement('button');item.className='archive-entry';label.textContent=row.label;button.className='button';button.textContent='Restore';button.type='button';
      button.addEventListener('click',async()=>{button.disabled=true;const uid=store.currentUser()?.uid;try{await store.request(row.action,{...row.fields,expectedRevision:row.revision,token:uid});if(store.currentUser()?.uid!==uid)return;await onReload();if(store.currentUser()?.uid===uid)await render();}catch(error){status.textContent=error.message;onError(error);}finally{button.disabled=false;}});
      item.append(label,button);list.append(item);
    }
  }
  document.querySelector('#settings-button').addEventListener('click',()=>{if(store.currentUser())render().catch(onError);else{list.replaceChildren();status.textContent='Sign in to view your archives.';}});
}
