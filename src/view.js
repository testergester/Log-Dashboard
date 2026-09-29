export function createView(document) {
  const $ = selector => document.querySelector(selector);
  let current = null;
  let formKey = '';
  let settingsOpen = false;

  const zones = [...new Set(['Asia/Tashkent', 'UTC', ...(Intl.supportedValuesOf?.('timeZone') || [])])].sort();
  function fillZones(select, selected) {
    select.replaceChildren();
    for (const zone of [...new Set([...zones, selected])].filter(Boolean).sort()) {
      const option = document.createElement('option');
      option.value = zone;
      option.textContent = zone.replaceAll('_', ' ');
      select.append(option);
    }
    select.value = selected;
  }

  function render(state) {
    current = state;
    const ready = state.phase === 'ready';
    const saving = state.phase === 'saving';
    const onboarding = state.phase === 'onboarding' || (saving && !state.workspace);
    const privateVisible = ready || saving || onboarding;
    const key = privateVisible ? `${state.user.id}:${state.workspace?.revision || 'new'}` : '';
    if (!privateVisible) {
      // Remove, not merely hide, all rendered account data on every auth boundary.
      for (const id of ['workspace-title', 'workspace-detail', 'account-email', 'onboarding-account']) $(`#${id}`).textContent = '';
      for (const id of ['display-name', 'settings-name']) $(`#${id}`).value = '';
      $('#timezone').replaceChildren();
      $('#settings-timezone').replaceChildren();
      settingsOpen = false;
    } else if (key !== formKey) {
      const name = state.workspace?.display_name || state.user.user_metadata?.full_name || '';
      $('#display-name').value = name;
      $('#settings-name').value = name;
      fillZones($('#timezone'), state.workspace?.timezone || 'Asia/Tashkent');
      fillZones($('#settings-timezone'), state.workspace?.timezone || 'Asia/Tashkent');
    }
    formKey = key;
    $('#access-panel').hidden = !['signed-out', 'sending-link', 'check-email'].includes(state.phase);
    $('#email-button').disabled = state.phase === 'sending-link';
    $('#email-input').disabled = ['sending-link', 'check-email'].includes(state.phase);
    if (privateVisible) $('#email-input').value = '';
    if (state.email) $('#email-input').value = state.email;
    $('#email-button').textContent = state.phase === 'sending-link' ? 'Requesting link…' : state.phase === 'check-email' ? 'Send another link' : 'Email me a sign-in link';
    $('#cancel-button').hidden = state.phase !== 'check-email';
    $('#retry-button').hidden = !['error', 'signout-error'].includes(state.phase) && !state.reloadRequired;
    $('#retry-button').textContent = state.phase === 'signout-error' ? 'Retry sign-out' : state.reloadRequired ? 'Reload workspace' : 'Retry';
    $('#auth-status').hidden = !state.message;
    $('#auth-status').textContent = state.message;
    $('#connection-state').textContent = ready ? 'Connected' : onboarding ? 'Set up your workspace' :
      ['loading', 'saving', 'signing-out'].includes(state.phase) ? 'Please wait…' : 'Not connected';
    $('#onboarding').hidden = !onboarding;
    $('#workspace').hidden = !ready || settingsOpen;
    $('#account-settings').hidden = !settingsOpen || !(ready || (saving && state.workspace));
    $('#settings-button').hidden = !ready;
    $('#sign-out-button').hidden = !state.user || !(privateVisible || state.phase === 'error');
    for (const form of ['onboarding-form', 'settings-form']) {
      for (const field of $(`#${form}`).elements) field.disabled = saving;
    }
    $('#settings-timezone').disabled = saving || state.hasSchedules;
    $('#create-workspace-button').textContent = saving ? 'Creating workspace…' : 'Create my workspace';
    $('#save-settings-button').textContent = saving ? 'Saving…' : 'Save settings';
    if (privateVisible) {
      $('#onboarding-account').textContent = `Signed in as ${state.user.email || 'your email account'}`;
      $('#account-email').textContent = `Email: ${state.user.email || ''}`;
      $('#workspace-title').textContent = state.workspace ? `Welcome, ${state.workspace.display_name}` : '';
      $('#workspace-detail').textContent = state.workspace ? `Your workspace is ready. Timezone: ${state.workspace.timezone}.` : '';
      $('#timezone-hint').textContent = state.hasSchedules ? 'Your timezone is fixed because this workspace has schedules.' : 'You can change your timezone until you create a schedule.';
    }
    $('#dashboard-app').hidden = !ready || settingsOpen;
    document.querySelector('.first-use-grid').hidden = ready;
  }

  function renderDashboard(content) {
    $('#dashboard-app').replaceChildren(content);
  }

  function bind(controller) {
    $('#email-form').addEventListener('submit', event => {
      event.preventDefault(); void controller.signIn($('#email-input').value);
    });
    $('#cancel-button').addEventListener('click', () => controller.cancel());
    $('#retry-button').addEventListener('click', () => void (current.phase === 'signout-error' ? controller.signOut() : controller.retry()));
    for (const id of ['sign-out-button', 'settings-sign-out']) $(`#${id}`).addEventListener('click', () => void controller.signOut());
    $('#settings-button').addEventListener('click', () => {
      settingsOpen = true; render(current); $('#settings-name').focus();
    });
    $('#close-settings').addEventListener('click', () => {
      settingsOpen = false; render(current); $('#settings-button').focus();
    });
    for (const [form, name, zone] of [['onboarding-form', 'display-name', 'timezone'], ['settings-form', 'settings-name', 'settings-timezone']]) {
      $(`#${form}`).addEventListener('submit', event => {
        event.preventDefault();
        void controller.saveProfile({ display_name: $(`#${name}`).value, timezone: $(`#${zone}`).value });
      });
    }
  }
  return { render, renderDashboard, bind };
}
