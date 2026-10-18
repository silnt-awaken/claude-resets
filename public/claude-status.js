/* Official public service status; no account data or browser storage. */
(() => {
  'use strict';
  const card = document.querySelector('#claude-status');
  const strings = document.querySelector('#claude-status-i18n');
  if (!card || !strings) return;
  const m = JSON.parse(strings.textContent);
  const summary = card.querySelector('[data-status-summary]');
  const hint = card.querySelector('[data-status-hint]');
  const services = card.querySelector('[data-status-services]');
  const incidents = card.querySelector('[data-status-incidents]');
  const checked = card.querySelector('[data-status-checked]');
  const refresh = card.querySelector('[data-status-refresh]');
  let busy = false;
  let lastCheck = 0;
  refresh.hidden = false;
  summary.textContent = m.loading;

  function unavailable(stale = false) {
    card.dataset.state = 'unknown';
    summary.textContent = m.unavailable;
    hint.textContent = stale ? m.stale : m.unavailableHint;
    hint.hidden = false;
    services.hidden = true;
    incidents.hidden = true;
  }

  async function update() {
    if (busy || document.hidden) return;
    busy = true;
    refresh.disabled = true;
    try {
      const response = await fetch('/api/v1/claude-status', { cache: 'no-store', signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw new Error('Status unavailable');
      const data = await response.json();
      const checkedAt = Date.parse(data.checked_at);
      if (!Number.isFinite(checkedAt) || Date.now() - checkedAt > 120000 || checkedAt > Date.now() + 60000) throw new Error('Status out of date');
      if (!Object.hasOwn(m.overall, data.state) || !Array.isArray(data.services) || !Array.isArray(data.incidents)) throw new Error('Unknown status');
      services.replaceChildren();
      for (const service of data.services) {
        const item = document.createElement('li');
        const name = document.createElement('strong');
        const state = document.createElement('span');
        name.textContent = m.services[service.key] || service.key;
        state.textContent = m.states[service.state] || m.states.unknown;
        item.dataset.state = Object.hasOwn(m.states, service.state) ? service.state : 'unknown';
        item.append(name, state);
        services.append(item);
      }
      services.hidden = false;
      const list = incidents.querySelector('ul');
      list.replaceChildren();
      for (const incident of data.incidents) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = 'https://status.claude.com/';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = incident.title;
        item.append(link);
        list.append(item);
      }
      incidents.hidden = data.incidents.length === 0;
      card.dataset.state = data.state;
      summary.textContent = m.overall[data.state];
      hint.hidden = true;
      lastCheck = checkedAt;
      const time = new Intl.DateTimeFormat(document.documentElement.lang, { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(new Date(checkedAt));
      checked.textContent = m.checked.replace('{time}', time);
    } catch {
      unavailable();
    } finally {
      busy = false;
      refresh.disabled = false;
    }
  }
  refresh.addEventListener('click', update);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (lastCheck && Date.now() - lastCheck > 120000) unavailable(true);
      update();
    }
  });
  setInterval(() => {
    if (lastCheck && Date.now() - lastCheck > 120000) unavailable(true);
    update();
  }, 60000);
  update();
})();
