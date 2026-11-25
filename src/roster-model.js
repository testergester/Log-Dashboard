// New attendance sheets start with the current roster, even when a teacher
// imports students after the lesson date. Saved sheets keep their dated roster.
export function lessonEnrollments(enrollments,{classId,date,includeCurrent=false}){
  return enrollments.filter(e=>e.classId===classId&&(
    ((!e.joinedOn||e.joinedOn<=date)&&(!e.leftOn||date<e.leftOn))||
    (includeCurrent&&e.active===true&&!e.leftOn)
  ));
}
