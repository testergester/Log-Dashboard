export const studentIdentity = (name,classId) => classId+'\u0000'+String(name||'').normalize('NFKC').trim().replace(/[‘’ʼʻ]/g,"'").replace(/\s+/g,' ').toLocaleLowerCase('en');
const normalize = value => String(value||'').normalize('NFKC').trim().toLocaleLowerCase('en');
function delimited(source,delimiter){
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(quoted){if(ch==='"'){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;}
    else if(ch==='"'&&!cell.trim()&&!closed){cell='';quoted=true;}
    else if(ch===delimiter||ch==='\n'){row.push(cell.trim());cell='';closed=false;if(ch==='\n'){rows.push(row);row=[];}}
    else {if(closed&&ch.trim())throw new Error('Unexpected text after a quoted field. Check the pasted table.');cell+=ch;}
  }
  if(quoted)throw new Error('A quoted field is incomplete. Check the pasted table.');
  if(cell||row.length){row.push(cell.trim());rows.push(row);}return rows;
}
export function parseStudentPaste(source){
  if(typeof source!=='string'||source.length>200000)throw new Error('Paste up to 500 students (maximum 200,000 characters).');
  const text=source.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim();
  if(!text)return [];
  const first=text.split('\n').find(line=>line.trim())||'';
  let rows;
  if(first.includes('|'))rows=text.split('\n').map(line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(s=>s.trim()));
  else if(first.includes('\t'))rows=delimited(text,'\t');
  else if(first.includes(','))rows=delimited(text,',');
  else rows=text.split('\n').map(line=>[line.trim()]);
  rows=rows.filter(row=>row.some(Boolean)&&!row.every(c=>/^:?-{3,}:?$/.test(c)));
  const heading=s=>normalize(s).replace(/[\s_-]+/g,'');
  const nameHeaders=['fullname','studentname','name'],groupHeaders=['groupid','classid','group','class'];
  let nameColumn=0,groupColumn=1;
  if(rows[0]?.some(c=>nameHeaders.includes(heading(c)))){
    const header=rows.shift();nameColumn=header.findIndex(c=>nameHeaders.includes(heading(c)));groupColumn=header.findIndex(c=>groupHeaders.includes(heading(c)));
    if(header.length>2||header.length===2&&groupColumn<0)throw new Error('Use columns Full name and Group ID, or a single Full name column.');
  }
  if(rows.length>500)throw new Error('Import up to 500 students at a time.');
  return rows.map((row,index)=>({name:row[nameColumn]||'',group:groupColumn<0?'':row[groupColumn]||'',included:true,sourceRow:index+1,parseError:row.length>2?'Too many columns. Use Full name and Group ID.':''}));
}
export function planStudentImport(rows,{classes=[],students=[],archivedStudents=[],defaultClassId='',mapping={}}={}){
  const active=classes.filter(c=>c.active),seen=new Set(students.map(s=>studentIdentity(s.name,s.officialGroupId))),archived=new Set(archivedStudents.map(s=>studentIdentity(s.name,s.officialGroupId)));
  return rows.map(row=>{
    let classId=row.classId;
    if(classId===undefined){
      const group=normalize(row.group);
      if(!group)classId=defaultClassId;
      else if(Object.hasOwn(mapping,group))classId=mapping[group];
      else{
        const exact=active.filter(c=>normalize(c.id)===group),matches=exact.length?exact:active.filter(c=>normalize(c.name)===group);
        classId=matches.length===1?matches[0].id:'';
      }
    }
    const result={...row,classId:classId||'',status:'ready',message:'Ready to add'};
    const name=row.name.trim(),identity=studentIdentity(name,classId);
    if(!row.included)return {...result,status:'excluded',message:'Excluded'};
    if(row.parseError)return {...result,status:'error',message:row.parseError};
    if(!name||name.length>120||/[\u0000-\u001f]/.test(name))return {...result,status:'error',message:'Enter a name of 1–120 characters on one line.'};
    if(!active.some(c=>c.id===classId))return {...result,status:'error',message:row.group?'Group not found or ambiguous. Choose its class above.':'Choose a default class or exclude this row.'};
    if(archived.has(identity))return {...result,status:'duplicate',message:'Archived student exists. Restore from Settings.'};
    if(seen.has(identity))return {...result,status:'duplicate',message:'Already listed in this group; skipped.'};
    seen.add(identity);return result;
  });
}
export const groupLabelKey=normalize;
