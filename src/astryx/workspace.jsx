import React, {useLayoutEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal, flushSync} from 'react-dom';
import {Theme} from '@astryxdesign/core/theme';
import {Button} from '@astryxdesign/core/Button';
import {Badge} from '@astryxdesign/core/Badge';
import {Card} from '@astryxdesign/core/Card';
import {Heading} from '@astryxdesign/core/Heading';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import '../styles/styles.css';
import './workspace.css';
import dashboardHTML from '../../index.html?raw';
import analysisHTML from '../../analysis.html?raw';
import analysisStyles from '../styles/analysis.css?inline';

const isAnalysis = document.body.dataset.astryxView === 'analysis';
const classicURL = isAnalysis ? './analysis.html' : './index.html';

function DeskIcon({kind = 'desk'}) {
  const paths = {
    desk: <><path d="M4 5h16v15H4zM4 10h16M8 3v4m8-4v4M8 14h3m-3 3h6" /></>,
    chart: <><path d="M4 3v17h17M8 15v-4m5 4V6m5 9v-7" /></>,
    spark: <><path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" /></>,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

function Navigation() {
  return <>
    <div className="astryx-nav-row">
      <a className="astryx-brand" href="./astryx.html" aria-label="Teaching desk home">
        <span className="astryx-mark"><DeskIcon kind="spark" /></span>
        <span>Teaching desk<small>Your everyday teaching workspace</small></span>
      </a>
      <nav className="astryx-navigation" aria-label="Main navigation">
        <Button label="Teaching week" href="./astryx.html" variant={isAnalysis ? 'ghost' : 'secondary'} icon={<DeskIcon />} aria-current={!isAnalysis ? 'page' : undefined} />
        <Button label="Analysis" href="./astryx-analysis.html" variant={isAnalysis ? 'secondary' : 'ghost'} icon={<DeskIcon kind="chart" />} aria-current={isAnalysis ? 'page' : undefined} />
      </nav>
      <div className="astryx-utilities">
        <span className="connection-state" id="connection-state" role="status">Not connected</span>
        <Button id="settings-button" label="Settings" variant="ghost" />
        <Button id="sign-out-button" label="Sign out" variant="ghost" hidden />
        <Button label="Classic version" href={classicURL} variant="secondary" />
      </div>
    </div>
    {!isAnalysis && <div className="astryx-action-row">
      <span className="astryx-breadcrumb">WORKSPACE <span>/</span> Teaching week</span>
      <div className="topbar-actions">
        <Button id="bulk-students-button" label="Add students in bulk" variant="ghost" />
        <Button id="import-timetable-button" label="Import timetable image" variant="secondary" />
        <Button id="add-class-button" label="Add class" variant="primary" icon={<span aria-hidden="true">＋</span>} />
      </div>
    </div>}
  </>;
}

function PageHeading() {
  return <>
    <div>
      <div className="astryx-edition"><span className="astryx-edition-dot" />TEACHING DESK <span>/</span> <Badge label="Astryx edition" /></div>
      <Heading level={1} id={!isAnalysis ? 'page-title' : undefined}>{isAnalysis ? 'A clearer view of progress.' : 'A little space to teach well.'}</Heading>
      <p className="heading-detail" id={!isAnalysis ? 'page-subtitle' : undefined}>{isAnalysis ? 'Attendance, participation, and the details that help you plan what comes next.' : 'Your week, your students, and your next lesson. All together.'}</p>
    </div>
    <Card className="astryx-date-card" padding={3}>
      <DeskIcon />
      <div><small>Today · Tashkent</small><strong>{new Intl.DateTimeFormat('en', {timeZone: 'Asia/Tashkent', weekday: 'short', day: 'numeric', month: 'long'}).format(new Date())}</strong></div>
    </Card>
  </>;
}

// The existing controllers own this subtree. React owns the surrounding Astryx
// chrome, never the form fields, save states, or lists that the controllers update.
function SharedContent({nodes}) {
  const host = useRef(null);
  useLayoutEffect(() => { host.current.replaceChildren(...nodes); }, [nodes]);
  return <div className="astryx-shared-content" ref={host} />;
}

function mountWorkspace() {
  // Share the source markup so additions to the classic forms and dialogs also
  // appear here. DOMParser does not execute the classic entry point's scripts.
  const source = new DOMParser().parseFromString(isAnalysis ? analysisHTML : dashboardHTML, 'text/html');
  source.querySelectorAll('script').forEach(script => script.remove());
  const header = source.querySelector('.topbar');
  const heading = source.querySelector(isAnalysis ? '.analysis-heading > div' : '.page-heading');
  const access = source.querySelector('#access-panel');
  const accessSlot = source.createElement('div');
  const accessNodes = [...access.childNodes];
  access.replaceWith(accessSlot);
  header.replaceChildren();
  header.className = 'topbar astryx-topbar';
  heading.replaceChildren();
  heading.classList.add('astryx-page-heading');
  const empty = source.querySelector('#teaching-empty');
  empty?.replaceChildren();
  const workspace = document.querySelector('#astryx-workspace');
  workspace.replaceChildren(...source.body.childNodes);
  const root = createRoot(document.querySelector('#astryx-ui'));
  flushSync(() => root.render(<Theme theme={neutralTheme} mode="light">
    {createPortal(<Navigation />, header)}
    {createPortal(<PageHeading />, heading)}
    {createPortal(<Card id="access-panel" className="access-panel" padding={0} aria-labelledby="access-title"><SharedContent nodes={accessNodes} /></Card>, accessSlot)}
    {empty && createPortal(<EmptyState headingLevel={2} title="Ready when you are." description="Choose a class from your timetable to take attendance and plan your lesson." icon={<DeskIcon />} />, empty)}
  </Theme>));

  // Start the shared controllers only after their elements exist. Native disabled,
  // hidden, and connection states remain under the existing controller's ownership.
  document.querySelectorAll('#add-class-button, #bulk-students-button, #import-timetable-button').forEach(button => { button.disabled = true; });
}

async function start() {
  if (isAnalysis) {
    // Keep the analysis base styles ahead of the Astryx overrides, in dev and
    // production alike, without applying its generic form selectors to the desk.
    const stylesheet = document.createElement('style');
    stylesheet.textContent = analysisStyles;
    document.head.prepend(stylesheet);
  }
  mountWorkspace();
  if (isAnalysis) await import('../analysis.js');
  else await import('../script.js');
}

start().catch(error => {
  console.error('Astryx workspace could not start', error);
  const message = document.createElement('p');
  message.className = 'notice error';
  message.setAttribute('role', 'alert');
  message.textContent = 'The workspace could not open. Reload the page or return to the classic version.';
  document.querySelector('#astryx-workspace').prepend(message);
});
