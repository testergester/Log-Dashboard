export function progressReport(snapshot, selectedNotes = new Set()) {
  const meetings = snapshot.meetings.map(item => ({
    ...item,
    score: item.attendance === 'absent' ? -1 : item.attendance === 'present' ? Number(item.participation || 0) : null,
    note: selectedNotes.has(item.id) ? item.note || '' : ''
  }));
  const recorded = meetings.filter(item => item.attendance === 'present' || item.attendance === 'absent');
  const present = recorded.filter(item => item.attendance === 'present').length;
  const absent = recorded.length - present;
  const participation = recorded.filter(item => item.attendance === 'present')
    .reduce((sum, item) => sum + Number(item.participation || 0), 0);
  const absenceDeductions = -absent;
  return {
    ...snapshot, meetings,
    totals: { present, absent, attendance: recorded.length ? `${(100 * present / recorded.length).toFixed(1)}%` : 'No recorded attendance',
      participation, absenceDeductions, combined: participation + absenceDeductions }
  };
}
