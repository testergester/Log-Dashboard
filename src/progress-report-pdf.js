import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';

const fontUrl = new URL('../assets/DejaVuSans.ttf', import.meta.url);
const fontName = 'DejaVuSans.ttf';
let fontBase64;

async function loadFont() {
  if (fontBase64) return fontBase64;
  const response = await fetch(fontUrl);
  if (!response.ok) throw new Error('The report font could not be loaded.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  fontBase64 = btoa(binary);
  return fontBase64;
}

export async function createProgressReportPdf(report, suppliedFontBase64) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.addFileToVFS(fontName, suppliedFontBase64 || await loadFont());
  doc.addFont(fontName, 'DejaVu', 'normal');
  doc.setFont('DejaVu');
  const margin = 16;
  const line = (label, value, y) => {
    const lines = doc.splitTextToSize(`${label}: ${value || '—'}`, 178);
    doc.text(lines, margin, y);
    return y + lines.length * 5.5 + 1.5;
  };
  const header = () => {
    doc.setFontSize(15); doc.text('Student progress report', margin, 18);
    doc.setFontSize(9); doc.text(`${report.from} to ${report.to}`, margin, 25);
    doc.setDrawColor(200, 210, 224); doc.line(margin, 29, 194, 29);
  };
  header();
  doc.setFontSize(10);
  let y = 37;
  y = line('Teacher', report.teacher.name, y);
  y = line('Student', report.student.name, y);
  if (report.student.external_id) y = line('Student ID', report.student.external_id, y);
  y = line('Group', `${report.group.name} · ${report.group.subject}${report.group.code ? ` · ${report.group.code}` : ''}`, y);
  y = line('Period', `${report.from} to ${report.to}`, y);
  y += 2;
  y = line('Attendance', `${report.totals.present} present, ${report.totals.absent} absent · ${report.totals.attendance}`, y);
  y = line('Participation', String(report.totals.participation), y);
  y = line('Absence deductions', String(report.totals.absenceDeductions), y);
  y = line('Combined score', String(report.totals.combined), y) + 3;

  autoTable(doc, {
    startY: y, margin: { left: margin, right: margin, top: 34, bottom: 18 },
    rowPageBreak: 'avoid', showHead: 'everyPage',
    head: [['Date', 'Meeting', 'Attendance', 'Points', 'Student note']],
    body: report.meetings.length ? report.meetings.map(item => [item.actual_date,
      [item.lesson_type, item.status].filter(Boolean).join(' · ') || 'Attendance record',
      item.attendance || 'No recorded attendance', item.score === null ? '—' : String(item.score), item.note])
      : [['—', 'No recorded meetings', '—', '—', '']],
    styles: { font: 'DejaVu', fontStyle: 'normal', fontSize: 8, cellPadding: 2.5, overflow: 'linebreak' },
    headStyles: { fillColor: [28, 51, 80], font: 'DejaVu', fontStyle: 'normal' },
    columnStyles: { 0: { cellWidth: 25 }, 1: { cellWidth: 39 }, 2: { cellWidth: 35 }, 3: { cellWidth: 17 } },
    willDrawPage: () => {
      if (doc.internal.getCurrentPageInfo().pageNumber > 1) header();
    },
    didDrawPage: () => {
      const page = doc.internal.getCurrentPageInfo().pageNumber;
      doc.setFont('DejaVu'); doc.setFontSize(8);
      doc.text(`Page ${page}`, 194, 286, { align: 'right' });
    }
  });
  return doc;
}
