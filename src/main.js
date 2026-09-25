import { bindAuth, restoreSession } from './auth.js';
import { bindScheduling } from './scheduling.js';
import { bindLessonRecords } from './lesson-records.js';
import { bindAttendance } from './attendance.js';
import { bindStudents } from './students.js';

bindAuth();
bindScheduling();
bindLessonRecords();
bindAttendance();
bindStudents();
restoreSession();
