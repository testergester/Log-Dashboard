// Treat model output as untrusted suggestions. Only these fields reach the editor.
export function extractionDraft(value) {
  if(!value || !Array.isArray(value.classes) || value.classes.length>100) throw new Error('DeepSeek returned an invalid timetable. Try a clearer image.');
  const field=(s,max=120)=>typeof s==='string'?s.trim().slice(0,max):'';
  const classes=value.classes.map(c=>{
    if(!c || !Array.isArray(c.meetings)||!c.meetings.length||c.meetings.length>30) throw new Error('A class has an invalid meeting list. Try a clearer image.');
    return {requestedId:field(c.groupId,80),name:field(c.name),subject:field(c.subject),meetings:c.meetings.map(m=>({weekday:Number(m?.weekday)||0,start:field(m?.start,5),end:field(m?.end,5),room:field(m?.room)}))};
  });
  return {classes,warnings:Array.isArray(value.warnings)?value.warnings.slice(0,30).map(w=>field(w,500)).filter(Boolean):[]};
}
export function importClasses(drafts) {
  return drafts.map(c=>{
    const [first,...rest]=c.meetings;
    if(!first)throw new Error('Each class needs a meeting.');
    return {requestedId:c.requestedId,name:c.name,subject:c.subject,...first,meetings:rest};
  });
}
