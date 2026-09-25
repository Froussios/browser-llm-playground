// Prompt API playground. Plain script, no dependencies, no build step.
// The API surface differs between Chrome versions, so everything is feature-detected.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = {
    browser: $('browser'), apiPresence: $('api-presence'), availability: $('availability'),
    recheck: $('recheck'), otherApis: $('other-apis'), download: $('download'),
    downloadBar: $('download-bar'), downloadText: $('download-text'), help: $('help'), helpUnavailable: $('help-unavailable'),
    systemPrompt: $('system-prompt'), samplingParams: $('sampling-params'),
    temperature: $('temperature'), temperatureOut: $('temperature-out'),
    topk: $('topk'), topkOut: $('topk-out'),
    samplingModeWrap: $('sampling-mode-wrap'), samplingMode: $('sampling-mode'),
    language: $('language'), streaming: $('streaming'),
    newSession: $('new-session'), cloneSession: $('clone-session'), destroySession: $('destroy-session'),
    sessionSelect: $('session-select'),
    sessionState: $('session-state'), sessionUsage: $('session-usage'), sessionQuota: $('session-quota'),
    transcript: $('transcript'), clearTranscript: $('clear-transcript'),
    composer: $('composer'), prompt: $('prompt'), send: $('send'), abort: $('abort'),
    log: $('log'), logCount: $('log-count'), copyLog: $('copy-log'), clearLog: $('clear-log'),
  };

  const OTHER_APIS = ['Summarizer', 'Writer', 'Rewriter', 'Translator', 'LanguageDetector', 'Proofreader'];

  const state = {
    api: null,            // the LanguageModel global, or null
    samplingKind: 'none', // 'params' (temperature/topK) | 'mode' (samplingMode) | 'none'
    sessions: [],         // { id, label, session, view }
    active: null,         // entry from sessions
    nextId: 1,
    controller: null,     // AbortController of the in-flight call
    busy: false,
    logEntries: 0,
  };

  // ---------- raw log ----------

  // Compact JSON for display; functions and signals are shown as placeholders.
  function safeJson(value) {
    return JSON.stringify(value, (key, v) => {
      if (typeof v === 'function') return '[Function]';
      if (typeof AbortSignal !== 'undefined' && v instanceof AbortSignal) return '[AbortSignal]';
      if (v instanceof Error || (typeof DOMException !== 'undefined' && v instanceof DOMException)) {
        return { name: v.name, message: v.message };
      }
      return v;
    });
  }

  function log(call, args, outcome, ms) {
    const time = new Date().toISOString().slice(11, 23);
    const lines = [`[${time}] ${call}` + (ms != null ? `  (${ms.toFixed(0)} ms)` : '')];
    if (args !== undefined) lines.push('  args:   ' + safeJson(args));
    if (outcome && 'error' in outcome) {
      lines.push(`  error:  ${outcome.error?.name ?? 'Error'}: ${outcome.error?.message ?? String(outcome.error)}`);
    } else if (outcome && 'result' in outcome) {
      lines.push('  result: ' + safeJson(outcome.result));
    }
    el.log.textContent += lines.join('\n') + '\n\n';
    el.log.scrollTop = el.log.scrollHeight;
    el.logCount.textContent = `(${++state.logEntries})`;
  }

  // Wraps an API call so it is always logged with timing, result or error.
  async function traced(call, args, fn, summarize = (r) => r) {
    const t0 = performance.now();
    try {
      const result = await fn();
      log(call, args, { result: summarize(result) }, performance.now() - t0);
      return result;
    } catch (error) {
      log(call, args, { error }, performance.now() - t0);
      throw error;
    }
  }

  // ---------- environment detection ----------

  function describeBrowser() {
    const uad = navigator.userAgentData;
    if (uad?.brands?.length) {
      const text = uad.brands
        .filter((b) => !/not.?a.?brand/i.test(b.brand))
        .map((b) => `${b.brand} ${b.version}`)
        .join(', ') + (uad.platform ? ` on ${uad.platform}` : '');
      const isChrome = uad.brands.some((b) => b.brand === 'Google Chrome');
      return isChrome ? text : `${text} (not Google Chrome: the Prompt API may be unavailable)`;
    }
    return navigator.userAgent;
  }

  async function detect() {
    el.browser.textContent = describeBrowser();

    const present = OTHER_APIS.filter((name) => typeof self[name] !== 'undefined');
    el.otherApis.textContent = present.length ? present.join(', ') : 'none';

    state.api = typeof self.LanguageModel !== 'undefined' ? self.LanguageModel : null;
    if (!state.api) {
      el.apiPresence.textContent = 'missing';
      el.apiPresence.className = 'missing';
      el.availability.textContent = 'n/a';
      el.help.classList.remove('hidden');
      log('detect', undefined, { result: { LanguageModel: false, isSecureContext: self.isSecureContext } });
      return;
    }
    el.apiPresence.textContent = 'present';
    el.apiPresence.className = 'avail-available';

    // Sampling controls: extensions / older Chrome expose params() + temperature/topK,
    // newer web builds use samplingMode instead.
    if (typeof state.api.params === 'function') {
      try {
        const p = await traced('LanguageModel.params()', undefined, () => state.api.params());
        if (p) {
          state.samplingKind = 'params';
          setupRange(el.temperature, el.temperatureOut, p.defaultTemperature, p.maxTemperature, 0.05);
          setupRange(el.topk, el.topkOut, p.defaultTopK, p.maxTopK, 1);
          el.samplingParams.classList.remove('hidden');
        }
      } catch { /* fall through to samplingMode */ }
    }
    if (state.samplingKind === 'none') {
      state.samplingKind = 'mode';
      el.samplingModeWrap.classList.remove('hidden');
    }

    await checkAvailability();
  }

  function setupRange(input, output, def, max, step) {
    if (typeof max === 'number' && max > 0) input.max = String(max);
    input.step = String(step);
    if (typeof def === 'number') input.value = String(def);
    const sync = () => { output.textContent = input.value; };
    input.addEventListener('input', sync);
    sync();
  }

  async function checkAvailability() {
    if (!state.api) return;
    const opts = languageOptions();
    try {
      const a = await traced('LanguageModel.availability()', opts, () => state.api.availability(opts));
      el.availability.textContent = String(a);
      el.availability.className = 'avail-' + a;
      el.helpUnavailable.classList.toggle('hidden', a !== 'unavailable');
    } catch (e) {
      el.availability.textContent = `${e.name}: ${e.message}`;
      el.availability.className = 'avail-unavailable';
    }
  }

  // ---------- session options ----------

  function languageOptions() {
    const langs = el.language.value.split(',').map((s) => s.trim()).filter(Boolean);
    if (!langs.length) return {};
    return {
      expectedInputs: [{ type: 'text', languages: langs }],
      expectedOutputs: [{ type: 'text', languages: [...langs] }],
    };
  }

  // The only place that knows create() option names.
  function buildCreateOptions({ withSampling = true } = {}) {
    const opts = { ...languageOptions() };
    const sys = el.systemPrompt.value.trim();
    if (sys) opts.initialPrompts = [{ role: 'system', content: sys }];
    if (withSampling) {
      if (state.samplingKind === 'params') {
        // Chrome requires temperature and topK to be given together.
        opts.temperature = Number(el.temperature.value);
        opts.topK = Number(el.topk.value);
      } else if (state.samplingKind === 'mode' && el.samplingMode.value) {
        opts.samplingMode = el.samplingMode.value;
      }
    }
    return opts;
  }

  function monitor(m) {
    m.addEventListener('downloadprogress', (e) => {
      // Current Chrome reports loaded in [0, 1]; older builds reported bytes with a total.
      const frac = e.total && e.total !== 1 ? e.loaded / e.total : e.loaded;
      el.download.classList.remove('hidden');
      el.downloadBar.value = frac;
      el.downloadText.textContent = `${(frac * 100).toFixed(1)}%`;
      if (frac >= 1) {
        el.downloadText.textContent = '100% (loading model…)';
        setTimeout(checkAvailability, 1000);
      }
    });
  }

  // ---------- sessions ----------

  function usageOf(session) {
    if (!session) return { used: null, quota: null };
    const used = session.inputUsage ?? session.contextUsage ?? null;
    const quota = session.inputQuota ?? session.contextWindow ?? null;
    return { used, quota };
  }

  function sessionSummary(s) {
    if (!s) return s;
    const out = {};
    for (const k of ['inputUsage', 'inputQuota', 'contextUsage', 'contextWindow', 'temperature', 'topK', 'samplingMode']) {
      if (s[k] !== undefined) out[k] = s[k];
    }
    return out;
  }

  function attachOverflowListeners(entry) {
    const handler = (e) => {
      addMessage(entry, 'warn', `Event "${e.type}": the context window overflowed and older messages were dropped.`);
      log(`event ${e.type}`, undefined, { result: sessionSummary(entry.session) });
    };
    for (const type of ['quotaoverflow', 'contextoverflow']) {
      try { entry.session.addEventListener?.(type, handler); } catch { /* ignore */ }
    }
  }

  function registerSession(session, label, view) {
    const entry = { id: state.nextId++, label, session, view };
    entry.label = `#${entry.id} ${label}`;
    if (!entry.view) {
      entry.view = document.createElement('div');
    }
    entry.view.dataset.session = String(entry.id);
    el.transcript.appendChild(entry.view);
    attachOverflowListeners(entry);
    state.sessions.push(entry);
    const opt = document.createElement('option');
    opt.value = String(entry.id);
    opt.textContent = entry.label;
    el.sessionSelect.appendChild(opt);
    activate(entry);
    return entry;
  }

  function activate(entry) {
    state.active = entry;
    for (const s of state.sessions) s.view.classList.toggle('hidden', s !== entry);
    el.sessionSelect.value = entry ? String(entry.id) : '';
    refreshSessionInfo();
  }

  async function createSession() {
    if (!state.api) throw new DOMException('LanguageModel is not available in this browser.', 'NotSupportedError');
    let opts = buildCreateOptions();
    let session;
    try {
      session = await traced('LanguageModel.create()', opts,
        () => state.api.create({ ...opts, monitor }), sessionSummary);
    } catch (e) {
      const hadSampling = 'temperature' in opts || 'samplingMode' in opts;
      if (e?.name !== 'TypeError' || !hadSampling) throw e;
      opts = buildCreateOptions({ withSampling: false });
      log('note', undefined, { result: 'create() rejected the sampling options; retrying without them.' });
      session = await traced('LanguageModel.create()', opts,
        () => state.api.create({ ...opts, monitor }), sessionSummary);
    }
    checkAvailability();
    const entry = registerSession(session, 'new');
    const parts = [];
    if (opts.initialPrompts) parts.push('system prompt set');
    if (opts.temperature !== undefined) parts.push(`temperature ${opts.temperature}, topK ${opts.topK}`);
    if (opts.samplingMode) parts.push(`samplingMode ${opts.samplingMode}`);
    if (opts.expectedInputs) parts.push(`language ${opts.expectedInputs[0].languages.join(',')}`);
    addMessage(entry, 'system', `Session ${entry.label} created` + (parts.length ? ` (${parts.join('; ')})` : '') + '.');
    return entry;
  }

  async function cloneSession() {
    const src = state.active;
    if (!src) return;
    const session = await traced(`session ${src.label}.clone()`, undefined, () => src.session.clone(), sessionSummary);
    const view = src.view.cloneNode(true);
    const entry = registerSession(session, `clone of #${src.id}`, view);
    addMessage(entry, 'system', `Session ${entry.label} created. It continues from the same context; ${src.label} is unchanged.`);
  }

  function destroySession() {
    const entry = state.active;
    if (!entry) return;
    traced(`session ${entry.label}.destroy()`, undefined, async () => entry.session.destroy()).catch(() => {});
    entry.view.remove();
    el.sessionSelect.querySelector(`option[value="${entry.id}"]`)?.remove();
    state.sessions = state.sessions.filter((s) => s !== entry);
    activate(state.sessions[state.sessions.length - 1] ?? null);
  }

  function refreshSessionInfo() {
    const entry = state.active;
    const has = !!entry;
    el.cloneSession.disabled = !has || state.busy;
    el.destroySession.disabled = !has || state.busy;
    el.sessionSelect.disabled = state.busy || state.sessions.length === 0;
    el.sessionState.textContent = has ? `${entry.label}${state.busy ? ' (busy)' : ''}` : 'none (created on first send)';
    const { used, quota } = usageOf(entry?.session);
    el.sessionUsage.textContent = used ?? '–';
    el.sessionQuota.textContent = quota ?? '–';
  }

  // ---------- transcript ----------

  function viewFor(entry) {
    if (entry) return entry.view;
    // Messages before any session exists (e.g. errors) go to a shared scratch view.
    let v = el.transcript.querySelector('[data-session="none"]');
    if (!v) {
      v = document.createElement('div');
      v.dataset.session = 'none';
      el.transcript.appendChild(v);
    }
    return v;
  }

  function addMessage(entry, role, text) {
    const msg = document.createElement('div');
    msg.className = `msg ${role}`;
    const r = document.createElement('div');
    r.className = 'role';
    r.textContent = role;
    const pre = document.createElement('pre');
    pre.textContent = text;
    msg.append(r, pre);
    viewFor(entry).appendChild(msg);
    scrollToBottom();
    return msg;
  }

  function setMeta(msg, text) {
    let meta = msg.querySelector('.meta');
    if (!meta) {
      meta = document.createElement('div');
      meta.className = 'meta';
      msg.appendChild(meta);
    }
    meta.textContent = text;
  }

  function scrollToBottom() {
    el.transcript.scrollTop = el.transcript.scrollHeight;
  }

  function showError(entry, e) {
    addMessage(entry, 'error', `${e?.name ?? 'Error'}: ${e?.message ?? String(e)}`);
  }

  // ---------- sending ----------

  function setBusy(busy) {
    state.busy = busy;
    el.send.disabled = busy;
    el.abort.disabled = !busy;
    el.newSession.disabled = busy;
    refreshSessionInfo();
  }

  async function send() {
    const text = el.prompt.value;
    if (!text.trim() || state.busy) return;
    if (!state.api) {
      showError(state.active, new DOMException(
        'LanguageModel is not available in this browser. See the setup steps at the top of the page.', 'NotSupportedError'));
      return;
    }

    setBusy(true);
    let entry = state.active;
    try {
      if (!entry) entry = await createSession();
    } catch (e) {
      showError(null, e);
      setBusy(false);
      return;
    }

    el.prompt.value = '';
    addMessage(entry, 'user', text);
    const reply = addMessage(entry, 'assistant', '');
    const pre = reply.querySelector('pre');
    const controller = new AbortController();
    state.controller = controller;
    const before = usageOf(entry.session).used;
    const streaming = el.streaming.checked;
    const t0 = performance.now();
    let output = '';
    let firstChunkMs = null;
    let chunks = 0;
    let status = 'done';

    try {
      if (streaming) {
        reply.classList.add('streaming');
        const stream = entry.session.promptStreaming(text, { signal: controller.signal });
        let cumulative = null; // older Chrome streamed the full text so far on every chunk
        for await (const chunk of stream) {
          chunks++;
          if (firstChunkMs === null) firstChunkMs = performance.now() - t0;
          if (cumulative === null && output.length > 0) {
            cumulative = chunk.length > output.length && chunk.startsWith(output);
          }
          output = cumulative ? chunk : output + chunk;
          pre.textContent = output;
          scrollToBottom();
        }
        log(`session ${entry.label}.promptStreaming()`, { input: text, options: { signal: '[AbortSignal]' } },
          { result: { output, chunks, cumulativeChunks: !!cumulative, session: sessionSummary(entry.session) } },
          performance.now() - t0);
      } else {
        output = await traced(`session ${entry.label}.prompt()`, { input: text, options: { signal: '[AbortSignal]' } },
          () => entry.session.prompt(text, { signal: controller.signal }));
        pre.textContent = output;
      }
    } catch (e) {
      if (streaming) {
        log(`session ${entry.label}.promptStreaming()`, { input: text }, { error: e }, performance.now() - t0);
      }
      if (e?.name === 'AbortError') {
        status = 'aborted';
      } else {
        status = 'error';
        showError(entry, e);
      }
    } finally {
      reply.classList.remove('streaming');
      if (!output && status !== 'done') pre.textContent = status === 'aborted' ? '(aborted before any output)' : '(no output)';
      const total = performance.now() - t0;
      const after = usageOf(entry.session).used;
      const parts = [status, `${total.toFixed(0)} ms`];
      if (firstChunkMs !== null) parts.push(`first chunk ${firstChunkMs.toFixed(0)} ms`, `${chunks} chunks`);
      parts.push(`${output.length} chars`);
      if (typeof before === 'number' && typeof after === 'number') parts.push(`+${after - before} tokens (prompt + reply)`);
      setMeta(reply, parts.join(' · '));
      state.controller = null;
      setBusy(false);
      el.prompt.focus();
    }
  }

  // ---------- wiring ----------

  el.composer.addEventListener('submit', (e) => { e.preventDefault(); send(); });
  el.prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  el.abort.addEventListener('click', () => state.controller?.abort());
  el.recheck.addEventListener('click', checkAvailability);
  el.language.addEventListener('change', checkAvailability);

  el.newSession.addEventListener('click', async () => {
    if (state.busy) return;
    setBusy(true);
    try { await createSession(); } catch (e) { showError(state.active, e); } finally { setBusy(false); }
  });
  el.cloneSession.addEventListener('click', async () => {
    if (state.busy) return;
    setBusy(true);
    try { await cloneSession(); } catch (e) { showError(state.active, e); } finally { setBusy(false); }
  });
  el.destroySession.addEventListener('click', () => { if (!state.busy) destroySession(); });
  el.sessionSelect.addEventListener('change', () => {
    const entry = state.sessions.find((s) => String(s.id) === el.sessionSelect.value);
    if (entry) activate(entry);
  });

  el.clearTranscript.addEventListener('click', () => { viewFor(state.active).replaceChildren(); });
  el.copyLog.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(el.log.textContent);
      el.copyLog.textContent = 'Copied';
    } catch {
      el.copyLog.textContent = 'Copy failed';
    }
    setTimeout(() => { el.copyLog.textContent = 'Copy log'; }, 1200);
  });
  el.clearLog.addEventListener('click', () => {
    el.log.textContent = '';
    state.logEntries = 0;
    el.logCount.textContent = '(0)';
  });

  refreshSessionInfo();
  detect().catch((e) => log('detect', undefined, { error: e }));
})();
