import { createClient } from '@supabase/supabase-js';

export function createSupabaseAccess(config, factory = createClient) {
  const client = factory(config.url, config.key, {
    auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
    global: { fetch: (url, options = {}) => fetch(url, {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000)
    }) }
  });
  return createAuthAccess(client);
}

function checked(result) {
  if (result.error) throw result.error;
  return result.data;
}

function checkedWrite(result, operationId) {
  if (result.error) {
    console.error('dashboard_write failed', { operationId, code: result.error.code || 'UNKNOWN' });
    throw result.error;
  }
  return result.data;
}

/** Provider boundary: no Supabase SDK calls belong in UI/controller code. */
export function createAuthAccess(client) {
  return {
    subscribe(listener) {
      const { data } = client.auth.onAuthStateChange(listener);
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, emailRedirectTo) {
      checked(await client.auth.signInWithOtp({ email, options: { emailRedirectTo, shouldCreateUser: true } }));
    },
    async exchange(code, flowId) {
      return checked(await client.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined)).session;
    },
    async session() { return checked(await client.auth.getSession()).session; },
    async user() { return checked(await client.auth.getUser()).user; },
    async signOut() { checked(await client.auth.signOut({ scope: 'local' })); },
    async workspace(ownerId) {
      return checked(await client.from('workspaces').select('id,owner_id,display_name,timezone,revision')
        .eq('owner_id', ownerId).maybeSingle());
    },
    async hasSchedules(workspaceId) {
      return checked(await client.from('schedule_slots').select('id').eq('workspace_id', workspaceId).limit(1)).length > 0;
    },
    async saveProfile(workspace, payload, operationId) {
      return checkedWrite(await client.rpc('dashboard_write', {
        p_workspace_id: workspace?.id || null,
        p_operation_id: operationId,
        p_action: workspace ? 'save_workspace' : 'ensure_workspace',
        p_payload: workspace ? { ...payload, expected_revision: workspace.revision } : payload
      }), operationId);
    },
    async listGroups(workspaceId) {
      const groups = checked(await client.from('groups').select('id,name,subject,code,archived,revision,created_at,updated_at')
        .eq('workspace_id', workspaceId).order('name')) || [];
      const slots = checked(await client.from('schedule_slots').select('id,group_id,revision')
        .eq('workspace_id', workspaceId)) || [];
      const versions = checked(await client.from('schedule_slot_versions').select('id,schedule_slot_id,weekday,start_time,end_time,room,effective_from,effective_to')
        .eq('workspace_id', workspaceId).order('effective_from')) || [];
      return groups.map(group => ({ ...group, slots: slots.filter(slot => slot.group_id === group.id)
        .map(slot => ({ ...slot, versions: versions.filter(version => version.schedule_slot_id === slot.id) })) }));
    },
    async listStudents(workspaceId) {
      const students = checked(await client.from('students').select('id,name,external_id,revision')
        .eq('workspace_id', workspaceId).order('name')) || [];
      const enrollments = checked(await client.from('enrollments').select('id,group_id,student_id,starts_on,ends_on,revision')
        .eq('workspace_id', workspaceId).order('starts_on')) || [];
      return { students, enrollments };
    },
    async listMeetings(workspaceId, from, to) {
      return checked(await client.rpc('list_meetings', { p_workspace_id: workspaceId, p_from: from, p_to: to })) || [];
    },
    async meetingDetails(workspaceId, meeting) {
      const previous = await this.groupHistory(workspaceId, meeting.group_id, meeting.actual_date);
      if (!meeting.id) return { lesson: null, attendance: null,
        roster: await this.roster(workspaceId, meeting.group_id, meeting.actual_date),
        previousNotes: previous.items, previousNextOffset: previous.nextOffset };
      const [lessonRows, checklistRows] = await Promise.all([
        client.from('lesson_records').select('meeting_id,notes,rating,lesson_type,status,revision').eq('workspace_id', workspaceId).eq('meeting_id', meeting.id).maybeSingle(),
        client.from('attendance_checklists').select('meeting_id,revision').eq('workspace_id', workspaceId).eq('meeting_id', meeting.id).maybeSingle()
      ]);
      const lesson = checked(lessonRows);
      const attendance = checked(checklistRows);
      const entries = attendance ? checked(await client.from('attendance_entries')
        .select('student_id,student_name,attendance,participation,note').eq('workspace_id', workspaceId).eq('meeting_id', meeting.id).order('student_name')) : [];
      return { lesson, attendance: attendance ? { ...attendance, entries: entries || [] } : null,
        roster: attendance ? entries || [] : await this.roster(workspaceId, meeting.group_id, meeting.actual_date),
        previousNotes: previous.items, previousNextOffset: previous.nextOffset };
    },
    async groupHistory(workspaceId, groupId, beforeDate, offset = 0, limit = 8) {
      const items = [];
      let cursor = offset;
      while (items.length <= limit) {
        const meetings = checked(await client.from('meetings').select('id,actual_date,group_name')
          .eq('workspace_id', workspaceId).eq('group_id', groupId).lt('actual_date', beforeDate)
          .order('actual_date', { ascending: false }).order('id', { ascending: false })
          .range(cursor, cursor + 49)) || [];
        if (!meetings.length) break;
        const lessons = checked(await client.from('lesson_records').select('meeting_id,notes,rating,lesson_type,status')
          .eq('workspace_id', workspaceId).in('meeting_id', meetings.map(item => item.id))) || [];
        for (const meeting of meetings) {
          const index = cursor++;
          const lesson = lessons.find(item => item.meeting_id === meeting.id);
          if (!lesson) continue;
          items.push({ ...meeting, lesson });
          if (items.length > limit) return { items: items.slice(0, limit), nextOffset: index };
        }
        if (meetings.length < 50) break;
      }
      return { items, nextOffset: null };
    },
    async roster(workspaceId, groupId, date) {
      const enrollments = checked(await client.from('enrollments').select('student_id,starts_on,ends_on')
        .eq('workspace_id', workspaceId).eq('group_id', groupId).lte('starts_on', date)
        .or(`ends_on.is.null,ends_on.gt.${date}`)) || [];
      if (!enrollments.length) return [];
      const students = checked(await client.from('students').select('id,name').eq('workspace_id', workspaceId)
        .in('id', enrollments.map(item => item.student_id))) || [];
      return students.map(student => ({ student_id: student.id, student_name: student.name,
        attendance: 'present', participation: 0, note: '' }));
    },
    async save(action, workspaceId, payload, operationId) {
      return checkedWrite(await client.rpc('dashboard_write', {
        p_workspace_id: workspaceId, p_operation_id: operationId, p_action: action, p_payload: payload
      }), operationId);
    },
    async rescheduleMeeting(workspaceId, { scheduleSlotId, originalDate, expectedRevision, actualDate, startTime, endTime, room }, operationId) {
      return this.save('reschedule_meeting', workspaceId, {
        schedule_slot_id: scheduleSlotId, original_date: originalDate, expected_revision: expectedRevision,
        actual_date: actualDate, start_time: startTime, end_time: endTime, room
      }, operationId);
    },
    async restoreMeeting(workspaceId, { scheduleSlotId, originalDate, expectedRevision }, operationId) {
      return this.save('restore_meeting', workspaceId, {
        schedule_slot_id: scheduleSlotId, original_date: originalDate, expected_revision: expectedRevision
      }, operationId);
    },
    async studentHistory(workspaceId, studentId, offset = 0, limit = 20) {
      const memberships = checked(await client.from('enrollments').select('group_id,starts_on,ends_on').eq('workspace_id', workspaceId).eq('student_id', studentId)) || [];
      const groupIds = [...new Set(memberships.map(item => item.group_id))];
      if (!groupIds.length) return { items: [], nextOffset: null };
      const items = [];
      let cursor = offset;
      while (items.length <= limit) {
        const meetings = checked(await client.from('meetings').select('id,group_id,actual_date,group_name,subject,start_time,room')
          .eq('workspace_id', workspaceId).in('group_id', groupIds).order('actual_date', { ascending: false })
          .order('id', { ascending: false }).range(cursor, cursor + 49)) || [];
        if (!meetings.length) break;
        const entryData = checked(await client.from('attendance_entries')
          .select('meeting_id,student_name,attendance,participation,note').eq('workspace_id', workspaceId)
          .eq('student_id', studentId).in('meeting_id', meetings.map(item => item.id))) || [];
        const eligible = meetings.filter(meeting => entryData.some(entry => entry.meeting_id === meeting.id) ||
          memberships.some(member => member.group_id === meeting.group_id && member.starts_on <= meeting.actual_date &&
            (!member.ends_on || member.ends_on > meeting.actual_date)));
        const lessonData = eligible.length ? checked(await client.from('lesson_records')
          .select('meeting_id,notes,rating,lesson_type,status').eq('workspace_id', workspaceId)
          .in('meeting_id', eligible.map(item => item.id))) || [] : [];
        for (const meeting of meetings) {
          const index = cursor++;
          if (!eligible.includes(meeting)) continue;
          items.push({ ...meeting,
            lesson: lessonData.find(item => item.meeting_id === meeting.id) || null,
            attendance: entryData.find(item => item.meeting_id === meeting.id) || null });
          if (items.length > limit) return { items: items.slice(0, limit), nextOffset: index };
        }
        if (meetings.length < 50) break;
      }
      return { items, nextOffset: null };
    },
    async studentScoreTotals(workspaceId, studentId, groupId) {
      let overall = 0;
      let group = 0;
      for (let offset = 0; ; offset += 200) {
        const entries = checked(await client.from('attendance_entries').select('meeting_id,attendance,participation')
          .eq('workspace_id', workspaceId).eq('student_id', studentId).range(offset, offset + 199)) || [];
        if (!entries.length) break;
        const meetings = checked(await client.from('meetings').select('id,group_id').eq('workspace_id', workspaceId)
          .in('id', entries.map(item => item.meeting_id))) || [];
        for (const entry of entries) {
          const score = entry.attendance === 'absent' ? -1 : Number(entry.participation);
          overall += score;
          if (meetings.some(meeting => meeting.id === entry.meeting_id && meeting.group_id === groupId)) group += score;
        }
        if (entries.length < 200) break;
      }
      return { group, overall };
    },
    async studentProgressReport(workspaceId, studentId, groupId, from, to) {
      return checked(await client.rpc('student_progress_report', {
        p_workspace_id: workspaceId, p_student_id: studentId, p_group_id: groupId, p_from: from, p_to: to
      }));
    }
  };
}
