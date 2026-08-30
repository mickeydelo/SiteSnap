    import { readNdjson } from './stream.js';

    const ESSENTIAL_IDS = new Set([
      'hero-nhmrx', 'performance-quarterly', 'performance-calendar-year',
      'performance-medalist-ratings', 'performance-morningstar-ratings', 'tey-sample',
      'distributions-since-inception', 'characteristics-maturity'
    ]);

    const state = {
      siteId: '', site: null, config: null, defaults: null,
      activePage: 0, query: '', pollTimer: null, jobId: null, rendered: 0, processed: 0, running: false,
      captureKey: '', activePreset: 'recommended',
      runtime: { mode: 'local', captureEnabled: true, captureKeyRequired: false, limits: null },
    };

    async function boot() {
      state.siteId = new URLSearchParams(location.search).get('site') || '';
      if (!state.siteId) { location.href = '/'; return; }
      try {
        const [configResponse, sitesResponse, healthResponse] = await Promise.all([
          fetch(`/api/config/${encodeURIComponent(state.siteId)}`),
          fetch('/api/sites'),
          fetch('/api/health', { cache: 'no-store' })
        ]);
        const config = await configResponse.json();
        const sites = await sitesResponse.json();
        const health = await healthResponse.json();
        if (!configResponse.ok) throw new Error(config.error || `HTTP ${configResponse.status}`);
        if (!sitesResponse.ok) throw new Error(sites.error || `HTTP ${sitesResponse.status}`);
        if (!healthResponse.ok) throw new Error(health.error || `HTTP ${healthResponse.status}`);
        state.site = sites.find(site => site.id === state.siteId) || { name: state.siteId };
        state.config = clone(config);
        state.defaults = clone(config);
        state.runtime = health;
        state.captureKey = health.captureKey || '';
        document.getElementById('project-name').textContent = state.site.name;
        const hosted = state.runtime.mode !== 'local';
        document.getElementById('project-note').textContent = state.site.description || 'Capture configuration';
        if (hosted) {
          const runtimeMessage = `[SiteSnap] ${state.runtime.message || `Runtime mode: ${state.runtime.mode}`}`;
          if (state.runtime.captureEnabled) console.info(runtimeMessage);
          else console.warn(runtimeMessage);
        }
        bindStaticEvents();
        renderAll();
      } catch (error) {
        document.getElementById('content').innerHTML = `<div class="empty">Unable to load configuration: ${escapeHtml(error.message)}</div>`;
      }
    }

    function bindStaticEvents() {
      document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => applyPreset(button.dataset.preset)));
      document.getElementById('search').addEventListener('input', event => { state.query = event.target.value.trim().toLowerCase(); renderPage(); });
      document.getElementById('capture-button').addEventListener('click', startCapture);
      document.getElementById('close-modal').addEventListener('click', closeModal);
      document.getElementById('run-modal').addEventListener('click', event => { if (event.target === event.currentTarget && !state.running) closeModal(); });
      document.getElementById('mobile-page-select').addEventListener('change', event => {
        state.activePage = Number(event.target.value) || 0;
        renderSidebar();
        renderPage();
      });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !state.running) closeModal();
      });
      window.addEventListener('beforeunload', stopPoll);
    }

    function renderAll() {
      renderDevices();
      renderSidebar();
      renderMobilePageSelect();
      renderPage();
      renderPresetState();
      updateSummary();
    }

    function renderMobilePageSelect() {
      const select = document.getElementById('mobile-page-select');
      select.innerHTML = '';
      state.config.pages.forEach((page, index) => {
        const option = node('option', { value: index, text: `${page.label} · ${enabledOnPage(page)} selected` });
        option.selected = index === state.activePage;
        select.appendChild(option);
      });
    }

    function renderDevices() {
      const row = document.getElementById('device-row');
      row.innerHTML = '';
      ['desktop', 'mobile'].forEach(name => {
        const device = state.config.devices[name];
        const maxScale = Number(state.runtime.limits?.maxDeviceScale) || 2;
        if (Number(device.deviceScaleFactor) > maxScale) device.deviceScaleFactor = maxScale;
        const card = node('div', { class: `device${device.enabled === false ? ' disabled' : ''}` });
        const deviceLabel = name === 'desktop' ? 'Desktop' : 'Mobile';
        const enabled = node('input', { type: 'checkbox', 'aria-label': `Enable ${deviceLabel}` }); enabled.checked = device.enabled !== false;
        enabled.addEventListener('change', () => {
          const other = name === 'desktop' ? 'mobile' : 'desktop';
          if (!enabled.checked && state.config.devices[other].enabled === false) { enabled.checked = true; return; }
          device.enabled = enabled.checked; markCustom(); renderAll();
        });
        card.append(enabled, node('span', { class: 'device-name', text: deviceLabel }));
        const width = miniNumber(device.viewport.width, value => { device.viewport.width = value; markCustom(); updateSummary(); }, `${deviceLabel} viewport width`);
        const height = miniNumber(device.viewport.height, value => { device.viewport.height = value; markCustom(); updateSummary(); }, `${deviceLabel} viewport height`);
        const scale = node('select', { class: 'mini-select', 'aria-label': `${deviceLabel} output scale` });
        [['1','1×'],['2','2×']].forEach(([value,label]) => {
          if (Number(value) > maxScale) return;
          const option = node('option', { value, text: label });
          option.selected = Number(device.deviceScaleFactor) === Number(value);
          scale.appendChild(option);
        });
        scale.addEventListener('change', () => { device.deviceScaleFactor = Number(scale.value); markCustom(); updateSummary(); });
        card.append(width, node('span', { text: '×' }), height, scale);
        row.appendChild(card);
      });
    }

    function renderSidebar() {
      const sidebar = document.getElementById('sidebar');
      sidebar.innerHTML = '';
      if (state.site.imageUrl) sidebar.appendChild(node('img', { class: 'preview', src: state.site.imageUrl, alt: `${state.site.name} preview` }));
      if (state.site.primaryUrl) sidebar.appendChild(node('a', { class: 'target-link', href: state.site.primaryUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Open live target', '↗'));
      sidebar.appendChild(node('div', { class: 'sidebar-label', text: 'Capture pages' }));
      const nav = node('nav', { class: 'page-nav' });
      state.config.pages.forEach((page, index) => {
        const row = node('div', { class: `page-row${index === state.activePage ? ' active' : ''}${page.enabled === false ? ' disabled' : ''}` });
        const button = node('button', { class: 'page-button', type: 'button' }, node('strong', { text: page.label }), node('small', { text: `${enabledOnPage(page)} selected` }));
        button.addEventListener('click', () => { state.activePage = index; renderSidebar(); renderMobilePageSelect(); renderPage(); });
        const toggle = toggleControl(page.enabled !== false, checked => { page.enabled = checked; markCustom(); renderAll(); }, `Enable ${page.label}`);
        row.append(button, toggle); nav.appendChild(row);
      });
      sidebar.appendChild(nav);
    }

    function renderPage() {
      const content = document.getElementById('content');
      const page = state.config.pages[state.activePage];
      if (!page) { content.innerHTML = '<div class="empty">No page selected.</div>'; return; }
      content.innerHTML = '';
      const head = node('div', { class: 'page-head' },
        node('div', { class: 'page-head-copy' }, node('h1', { text: page.label }), node('p', { text: page.path })),
        node('div', { class: 'page-switch' }, 'Page enabled ', toggleControl(page.enabled !== false, checked => { page.enabled = checked; markCustom(); renderAll(); }, `Enable ${page.label}`))
      );
      content.appendChild(head);

      const groups = new Map();
      page.steps.forEach((step, index) => {
        const haystack = `${step.label} ${step.description || ''} ${step.group || ''}`.toLowerCase();
        if (state.query && !haystack.includes(state.query)) return;
        const group = step.group || 'Capture states';
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push({ step, index });
      });

      if (!groups.size) { content.appendChild(node('div', { class: 'empty', text: 'No capture states match this filter.' })); return; }
      for (const [groupName, entries] of groups) {
        const section = node('section', { class: 'group' });
        const allOn = entries.every(({ step }) => step.enabled === true);
        const groupToggle = node('button', { class: 'group-toggle', type: 'button', text: allOn ? 'Disable group' : 'Enable group' });
        groupToggle.addEventListener('click', () => { entries.forEach(({ step }) => { step.enabled = !allOn; }); markCustom(); renderAll(); });
        section.appendChild(node('div', { class: 'group-head' }, node('h2', { text: groupName }), node('span', { class: 'group-line' }), groupToggle));
        const grid = node('div', { class: 'card-grid' });
        entries.forEach(({ step }) => grid.appendChild(renderStepCard(step)));
        section.appendChild(grid); content.appendChild(section);
      }
    }

    function renderStepCard(step) {
      const card = node('article', { class: `step-card${step.enabled === true ? '' : ' off'}` });
      const toggle = toggleControl(step.enabled === true, checked => { step.enabled = checked; markCustom(); renderAll(); }, `Include ${step.label}`);
      const mode = node('select', { class: 'mode', 'aria-label': 'Capture mode' });
      const modes = [['viewport','Viewport'],['fullPage','Full page']];
      if (step.selector || step.focusSelector) modes.push(['element','Element']);
      modes.forEach(([value,label]) => { const option = node('option', { value, text: label }); option.selected = (step.captureMode || 'viewport') === value; mode.appendChild(option); });
      mode.addEventListener('change', () => { step.captureMode = mode.value; markCustom(); renderPage(); updateSummary(); });
      card.appendChild(node('div', { class: 'step-head' }, toggle, node('div', { class: 'step-copy' }, node('h3', { text: step.label }), node('p', { text: step.description || '' })), mode));

      const options = node('div', { class: 'step-options' });
      if ((step.captureMode || 'viewport') === 'viewport') {
        ['desktop','mobile'].forEach(deviceName => {
          if (deviceName === 'mobile' && step.includeMobile === false) return;
          const dimensions = step[deviceName] || clone(state.config.devices[deviceName].viewport);
          step[deviceName] = dimensions;
          const row = node('div', { class: 'option-row' }, node('span', { class: 'option-label', text: deviceName === 'desktop' ? 'Desktop size' : 'Mobile size' }));
          const dim = node('div', { class: 'dims' });
          dim.append(
            miniNumber(dimensions.width, value => { dimensions.width = value; markCustom(); }, `${step.label} ${deviceName} width`),
            node('span', { text: '×' }),
            miniNumber(dimensions.height, value => { dimensions.height = value; markCustom(); }, `${step.label} ${deviceName} height`),
          );
          row.appendChild(dim); options.appendChild(row);
        });
      }

      (step.actions || []).forEach(action => {
        if (!action.editable) return;
        const row = node('label', { class: 'option-row' }, node('span', { class: 'option-label', text: action.label || action.type }));
        let input;
        if (Array.isArray(action.options)) {
          input = node('select', { class: 'option-input' });
          action.options.forEach(value => { const option = node('option', { value, text: value }); option.selected = value === action.value; input.appendChild(option); });
        } else {
          input = node('input', { class: 'option-input', type: 'text', value: action.value ?? '' });
        }
        input.addEventListener('change', () => { action.value = input.value; markCustom(); });
        row.appendChild(input); options.appendChild(row);
      });
      if (options.children.length) card.appendChild(options);

      const footer = node('div', { class: 'card-footer' });
      if (!step.mobileOnly) {
        const mobile = node('input', { type: 'checkbox', 'aria-label': `Include mobile for ${step.label}` }); mobile.checked = step.includeMobile !== false;
        mobile.disabled = state.config.devices.mobile.enabled === false;
        mobile.addEventListener('change', () => { step.includeMobile = mobile.checked; markCustom(); renderAll(); });
        footer.appendChild(node('label', { class: 'check-label' }, mobile, 'Include mobile'));
      } else footer.appendChild(node('span', { class: 'badge', text: 'Mobile only' }));
      if (step.waitFor || step.cleanupActions?.length) footer.appendChild(node('span', { class: 'badge', text: step.cleanupActions?.length ? 'Isolated state' : 'Waits for data' }));
      card.appendChild(footer);
      return card;
    }

    function applyPreset(name) {
      if (name === 'recommended') state.config = clone(state.defaults);
      if (name === 'essential') {
        state.config.pages.forEach(page => { page.enabled = true; page.steps.forEach(step => { step.enabled = ESSENTIAL_IDS.has(step.id); }); });
      }
      if (name === 'all') state.config.pages.forEach(page => { page.enabled = true; page.steps.forEach(step => { step.enabled = true; }); });
      if (name === 'clear') state.config.pages.forEach(page => page.steps.forEach(step => { step.enabled = false; }));
      state.activePreset = name;
      renderAll();
    }

    function markCustom() {
      state.activePreset = 'custom';
      renderPresetState();
    }

    function renderPresetState() {
      document.querySelectorAll('[data-preset]').forEach(button => {
        const active = button.dataset.preset === state.activePreset;
        button.classList.toggle('primary', active);
        button.setAttribute('aria-pressed', String(active));
      });
    }

    function updateSummary() {
      const total = countCaptures();
      const button = document.getElementById('capture-button');
      const enabledDevices = ['desktop', 'mobile'].filter(name => state.config.devices[name].enabled !== false);
      document.getElementById('capture-summary').textContent = `${total} output${total === 1 ? '' : 's'} · ${enabledDevices.join(' + ')}`;
      if (state.runtime.captureEnabled === false) {
        button.textContent = 'Capture unavailable';
        button.disabled = true;
        button.removeAttribute('title');
        return;
      }
      const maxCaptures = Number(state.runtime.limits?.maxCaptures) || Infinity;
      if (total > maxCaptures) {
        button.textContent = `Limit ${maxCaptures} · ${total}`;
        button.disabled = true;
        button.title = `Hosted capture supports up to ${maxCaptures} outputs per run.`;
        return;
      }
      button.textContent = `Capture · ${total}`;
      button.disabled = total === 0 || state.running;
      button.removeAttribute('title');
    }

    function countCaptures() {
      let total = 0;
      state.config.pages.forEach(page => {
        if (page.enabled === false) return;
        page.steps.forEach(step => {
          if (step.enabled !== true) return;
          if (state.config.devices.desktop.enabled !== false && !step.mobileOnly) total += 1;
          if (state.config.devices.mobile.enabled !== false && !step.desktopOnly && step.includeMobile !== false) total += 1;
        });
      });
      return total;
    }

    async function startCapture() {
      if (state.runtime.captureEnabled === false) return;
      const total = countCaptures();
      if (!total) return;
      state.running = true;
      state.jobId = crypto.randomUUID(); state.rendered = 0; state.processed = 0;
      showRunModal(total);
      updateSummary();
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (state.captureKey) headers.Authorization = `Bearer ${state.captureKey}`;
        if (state.runtime.mode === 'vercel-capture') headers.Accept = 'application/x-ndjson';
        const response = await fetch('/api/run', {
          method: 'POST', headers,
          body: JSON.stringify({ jobId: state.jobId, siteId: state.siteId, config: state.config })
        });
        if (response.status === 401) {
          throw new Error('Hosted authorization is out of date. Refresh the page and try again.');
        }
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok) {
          const body = contentType.includes('application/json')
            ? await response.json().catch(() => ({}))
            : {};
          throw new Error(body.error || `HTTP ${response.status}`);
        }
        if (contentType.includes('application/x-ndjson')) {
          await consumeHostedStream(response, total);
          return;
        }
        const body = await response.json().catch(() => ({}));
        if (['done', 'partial', 'error'].includes(body.status)) {
          renderCaptures(body.entries || []);
          return handleTerminalResult(body, body.total || total);
        }
        poll();
      } catch (error) { showRunError(error.message); }
    }

    async function consumeHostedStream(response, fallbackTotal) {
      let terminal = false;
      await readNdjson(response, event => {
        const total = Number(event.total) || fallbackTotal;
        if (event.type === 'start') {
          document.getElementById('run-status').textContent = 'Starting hosted Chromium…';
          updateRunProgress(0, total);
          return;
        }
        if (event.type === 'status') {
          document.getElementById('run-status').textContent = event.message || 'Hosted Chromium is running…';
          return;
        }
        if (event.type === 'capture') {
          appendCapture(event.entry);
          updateRunProgress(Number(event.processed) || state.rendered, total);
          return;
        }
        if (event.type === 'failure') {
          appendFailure(event.failure);
          updateRunProgress(Number(event.processed) || state.processed + 1, total);
          return;
        }
        if (event.type === 'complete') {
          terminal = true;
          const result = event.result || {};
          handleTerminalResult(result, Number(result.total) || total);
          return;
        }
        if (event.type === 'error') {
          terminal = true;
          throw new Error(event.error || 'Hosted capture failed.');
        }
      });
      if (!terminal) throw new Error('The hosted progress stream ended before the archive was ready.');
    }

    async function poll() {
      try {
        const response = await fetch(`/api/status/${encodeURIComponent(state.jobId)}`);
        const job = await response.json();
        if (!response.ok) throw new Error(job.error || `HTTP ${response.status}`);
        if (job.lastLog) document.getElementById('run-status').textContent = job.lastLog;
        renderCaptures(job.entries || []);
        const total = job.total || countCaptures();
        updateRunProgress((job.entries?.length || 0) + (job.failures?.length || 0), total);
        if (['done', 'partial', 'error'].includes(job.status)) return handleTerminalResult(job, total);
        state.pollTimer = setTimeout(poll, 900);
      } catch (error) { showRunError(error.message); }
    }

    function renderCaptures(entries) {
      const list = document.getElementById('captures');
      if (state.rendered === 0 && entries.length) list.innerHTML = '';
      for (let index = state.rendered; index < entries.length; index += 1) {
        appendCapture(entries[index]);
      }
      if (entries.length) list.scrollTop = list.scrollHeight;
    }

    function appendCapture(entry) {
      const list = document.getElementById('captures');
      list.querySelector('.empty')?.remove();
      const thumbnailUrl = entry.thumbnailUrl || (state.runtime.mode === 'local'
        ? `/api/thumbnail/${encodeURIComponent(state.jobId)}/${entry.index}`
        : null);
      const thumbnail = thumbnailUrl
        ? node('img', { src: thumbnailUrl, alt: `${entry.label} preview` })
        : node('div', { class: 'capture-thumb', text: '✓', 'aria-hidden': 'true' });
      list.appendChild(node('div', { class: 'capture-row' },
        thumbnail,
        node('strong', { text: entry.label })
      ));
      state.rendered += 1;
      list.scrollTop = list.scrollHeight;
    }

    function appendFailure(failure = {}) {
      const list = document.getElementById('captures');
      list.querySelector('.empty')?.remove();
      list.appendChild(node('div', { class: 'capture-row failed' },
        node('div', { class: 'capture-thumb', text: '!', 'aria-hidden': 'true' }),
        node('div', {},
          node('strong', { text: failure.label || 'Capture state failed' }),
          node('small', { text: clipText(failure.message || 'Review the diagnostic archive.', 150) })
        )
      ));
      list.scrollTop = list.scrollHeight;
    }

    function updateRunProgress(processed, total) {
      state.processed = Math.max(state.processed, Number(processed) || 0);
      const progress = total ? Math.min(100, Math.round((state.processed / total) * 100)) : 0;
      document.getElementById('progress').classList.remove('indeterminate');
      document.getElementById('progress-fill').style.width = `${progress}%`;
      document.getElementById('progress-label').textContent = `${state.processed} of ${total}`;
    }

    function showRunModal(total) {
      stopPoll();
      document.getElementById('run-modal').classList.remove('hidden');
      document.getElementById('run-title').textContent = `Capturing ${state.site.name}`;
      document.getElementById('run-status').textContent = 'Starting Chromium…';
      document.getElementById('spinner').classList.remove('hidden');
      document.getElementById('progress').classList.remove('indeterminate');
      document.getElementById('progress-fill').style.width = '0%';
      document.getElementById('progress-label').textContent = `0 of ${total}`;
      document.getElementById('run-mode-label').textContent = enabledDeviceLabel();
      document.getElementById('captures').innerHTML = '<div class="empty">Screenshots will appear here as they complete.</div>';
      const notice = document.getElementById('run-error'); notice.style.display = 'none'; notice.classList.remove('warning');
      document.getElementById('download').style.display = 'none';
      document.getElementById('close-modal').style.display = 'none';
      document.getElementById('run-panel').focus();
    }

    function handleTerminalResult(result, total) {
      if (result.status === 'done') return finishRun(total, result.downloadUrl);
      if (result.downloadUrl || result.archiveReady) {
        return finishRun(total, result.downloadUrl, result.status, result.failures || []);
      }
      return showRunError(result.error || 'Capture failed before an archive could be created.');
    }

    function finishRun(total, downloadUrl = null, status = 'done', failures = []) {
      stopPoll();
      state.running = false;
      document.getElementById('spinner').classList.add('hidden');
      document.getElementById('progress').classList.remove('indeterminate');
      const isComplete = status === 'done';
      document.getElementById('run-title').textContent = isComplete ? 'Capture complete' : 'Capture needs review';
      document.getElementById('run-status').textContent = isComplete
        ? 'Verified ZIP archive is ready.'
        : `Archive created with ${failures.length} failed state${failures.length === 1 ? '' : 's'}.`;
      document.getElementById('progress-fill').style.width = '100%';
      state.processed = total;
      document.getElementById('progress-label').textContent = `${total} of ${total}`;
      if (!isComplete) {
        const notice = document.getElementById('run-error');
        notice.textContent = failures.length
          ? failures.map(failure => `${failure.label}: ${clipText(failure.message, 180)}`).join(' · ')
          : 'Review the manifest and debug images in the archive.';
        notice.classList.add('warning');
        notice.style.display = 'block';
      }
      const download = document.getElementById('download');
      download.href = downloadUrl || `/api/download/${encodeURIComponent(state.jobId)}`;
      download.textContent = isComplete ? 'Download ZIP' : 'Download diagnostic ZIP';
      download.style.display = 'block';
      document.getElementById('close-modal').style.display = 'block';
      updateSummary();
    }

    function showRunError(message) {
      stopPoll();
      state.running = false;
      document.getElementById('spinner').classList.add('hidden');
      document.getElementById('progress').classList.remove('indeterminate');
      document.getElementById('run-title').textContent = 'Capture stopped';
      document.getElementById('run-status').textContent = 'Review the error and try again.';
      const error = document.getElementById('run-error'); error.textContent = message; error.style.display = 'block';
      document.getElementById('close-modal').style.display = 'block';
      updateSummary();
    }

    function enabledDeviceLabel() {
      const names = ['desktop', 'mobile'].filter(name => state.config.devices[name].enabled !== false);
      return names.length > 1 ? 'Desktop + mobile · isolated contexts' : `${names[0] || 'Browser'} · isolated context`;
    }

    function closeModal() { if (!state.running) document.getElementById('run-modal').classList.add('hidden'); }
    function stopPoll() { if (state.pollTimer) clearTimeout(state.pollTimer); state.pollTimer = null; }

    function enabledOnPage(page) { return page.steps.filter(step => step.enabled === true).length; }
    function miniNumber(value, onChange, label = 'Viewport dimension') {
      const input = node('input', { class: 'mini-input', type: 'number', min: '320', max: '3840', value, 'aria-label': label });
      input.addEventListener('change', () => { const next = Math.max(320, Math.min(3840, Number(input.value) || Number(value))); input.value = next; onChange(next); });
      return input;
    }
    function toggleControl(checked, onChange, label = 'Toggle capture') {
      const input = node('input', { type: 'checkbox', 'aria-label': label }); input.checked = checked;
      input.addEventListener('change', () => onChange(input.checked));
      return node('label', { class: 'toggle' }, input, node('span'));
    }
    function node(tag, attributes = {}, ...children) {
      const element = document.createElement(tag);
      Object.entries(attributes).forEach(([key, value]) => {
        if (key === 'class') element.className = value;
        else if (key === 'text') element.textContent = value;
        else if (value != null) element.setAttribute(key, value);
      });
      children.flat().forEach(child => { if (child != null) element.appendChild(child instanceof Node ? child : document.createTextNode(String(child))); });
      return element;
    }
    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function clipText(value, maxLength) { const text = String(value || 'Unknown error').replace(/\s+/g, ' ').trim(); return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text; }
    function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character])); }
    boot();
