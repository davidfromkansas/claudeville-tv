/* Claudeville TV: reads the game bot's live data from the claude-simcity2000 GitHub Pages site
   and shows every Claudeville 3 attempt as a stream. No build step, no dependencies. */
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const BASE = new URL(params.get('data') || '/claude-simcity2000/claudeville-3/', location.href).href;
  const POLL_MS = 60 * 1000;
  const GOAL = 100000, START = 2000, DEADLINE = 2050;
  const PACE_PER_YEAR = GOAL / (DEADLINE - START);
  const KINDS = ['strategy', 'build', 'zone', 'fix', 'budget', 'disaster', 'milestone'];
  const KIND_LABEL = { strategy: 'Plan', build: 'Build', zone: 'Zone', fix: 'Fix', budget: 'Budget', disaster: 'Disaster', milestone: 'Milestone' };

  const state = {
    list: [],                 // attempt numbers, newest first
    attempts: new Map(),      // n -> model
    route: { view: 'browse' },
    navCollapsed: store('navCollapsed') === '1',
    chatCollapsed: store('chatCollapsed') === '1',
    chatKind: 'all',
    chatQuery: '',
    source: null,             // selected video source key on the detail page
    shown: null,              // attempt number whose detail skeleton is on screen
    seen: new Set(),          // chat message keys already shown (to flash new ones)
    loaded: false,
  };

  // ---------- helpers ----------
  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem('cvtv.' + key);
      localStorage.setItem('cvtv.' + key, value);
    } catch (e) { /* storage blocked: keep defaults */ }
    return null;
  }
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    for (const c of kids) el.append(c.nodeType ? c : String(c));
    return el;
  }
  const icon = (d, size = 20, extra) => s('svg', { width: size, height: size, viewBox: '0 0 20 20', 'aria-hidden': 'true' },
    s('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }), ...(extra || []));
  const fmt = (v) => (v == null || isNaN(v) ? '–' : Math.round(v).toLocaleString('en-US'));
  const money = (v) => (v == null ? '–' : (v < 0 ? '−$' : '$') + fmt(Math.abs(v)));
  const short = (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(v || 0));
  const url = (rel, base) => new URL(rel, base).href;
  const bust = (u) => u + (u.includes('?') ? '&' : '?') + 't=' + Date.now();
  const pace = (gy) => Math.max(0, (gy - START) * PACE_PER_YEAR);
  const plain = (t) => String(t || '').replace(/\*\*|`/g, '').replace(/\*([^*]+)\*/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  function ago(iso) {
    const t = Date.parse(iso);
    if (!t) return '';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const hrs = Math.round(m / 60);
    return hrs < 48 ? hrs + ' hr ago' : Math.round(hrs / 24) + ' days ago';
  }
  async function getJSON(u) {
    try { const r = await fetch(bust(u), { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; }
  }
  async function getText(u) {
    try { const r = await fetch(bust(u), { cache: 'no-store' }); return r.ok ? await r.text() : null; } catch (e) { return null; }
  }

  // ---------- data ----------
  function parsePostMortem(md) {
    if (!md) return null;
    const lines = md.split('\n');
    const result = lines.find((l) => /^\*\*Result/.test(l.trim()));
    let summary = '';
    if (result) {
      const i = lines.indexOf(result);
      const para = [];
      for (let j = i; j < lines.length && lines[j].trim(); j++) para.push(lines[j].trim());
      summary = plain(para.join(' '));
    }
    const causes = [];
    let inCauses = false;
    for (const line of lines) {
      if (/^##\s/.test(line)) { inCauses = /top causes/i.test(line); continue; }
      if (!inCauses) continue;
      const m = line.match(/^\d+\.\s+\*\*(.+?)\*\*\s*(.*)$/);
      if (m) causes.push({ title: plain(m[1]).replace(/\.$/, ''), text: plain(m[2]) });
      else if (causes.length && line.trim()) causes[causes.length - 1].text += ' ' + plain(line.trim());
    }
    return { summary, causes };
  }

  async function loadAttempt(entry) {
    const n = entry.attempt;
    const dir = url(`attempt-${n}/`, BASE);
    const dash = url('dashboard/', dir);
    const d = url('data/', dash);
    const done = entry.status && entry.status !== 'playing';
    const [info, latest, metrics, activity, yearly, shots, recordings, pm] = await Promise.all([
      getJSON(url('attempt.json', dir)), getJSON(url('latest.json', d)), getJSON(url('metrics.json', d)),
      getJSON(url('activity.json', d)), getJSON(url('yearly.json', d)), getJSON(url('shots.json', d)),
      getJSON(url('recordings.json', d)), done ? getText(url('post-mortem/post-mortem.md', dir)) : null,
    ]);
    const rows = Array.isArray(metrics) ? metrics : [];
    let peakRow = null;
    for (const r of rows) if (!peakRow || r.population > peakRow.population) peakRow = r;
    const live = !done;
    const lastShot = Array.isArray(shots) && shots.length ? shots[shots.length - 1] : null;
    const pop = latest ? latest.population : (rows.length ? rows[rows.length - 1].population : 0);
    const peak = Math.max((info && info.peak) || 0, peakRow ? peakRow.population : 0, live ? pop : 0);
    const moves = Array.isArray(activity) ? activity : [];
    const strat = moves.find((m) => m.type === 'strategy');
    const lastRow = rows[rows.length - 1];
    return {
      n, status: entry.status || (info && info.status) || 'playing', live,
      success: /succe|met|won|done/i.test(entry.status || ''),
      reason: (info && info.reason) || entry.reason || '',
      dir, dash, latest, rows, moves, yearly: Array.isArray(yearly) ? yearly : [],
      peak, peakDate: peakRow ? peakRow.date : (latest && latest.date) || '',
      ended: (info && info.ended) || (latest && latest.date) || '',
      gy: lastRow ? lastRow.gy : (latest ? latest.year : START),
      pop, updated: latest && latest.updated,
      thumb: live ? bust(url('live.jpg', dash)) : (lastShot ? url(lastShot.file, dash) : url('live.jpg', dash)),
      timelapse: info && info.timelapse ? url(info.timelapse, dir) : null,
      parts: (Array.isArray(recordings) ? recordings : []).map((r, i) => ({ key: 'part' + i, label: 'Part ' + (i + 1), src: url(r.file, dash) })),
      strategy: strat ? strat.text : '',
      postMortem: parsePostMortem(pm),
      postMortemUrl: done && pm ? url('post-mortem/', dir) : null,
    };
  }

  async function refresh() {
    const list = await getJSON(url('attempts.json', BASE));
    if (!Array.isArray(list)) {
      if (!state.loaded) document.getElementById('main').replaceChildren(h('p', { class: 'error', text: 'Could not load the Claudeville 3 data. Try again in a minute.' }));
      return;
    }
    const jobs = list.map(async (e) => {
      const old = state.attempts.get(e.attempt);
      if (old && !old.live && old.status === e.status) return; // finished attempts don't change
      state.attempts.set(e.attempt, await loadAttempt(e));
    });
    await Promise.all(jobs);
    state.list = list.map((e) => e.attempt).sort((a, b) => b - a);
    state.loaded = true;
    render();
  }

  const liveAttempt = () => state.list.map((n) => state.attempts.get(n)).find((a) => a && a.live);
  const best = () => state.list.map((n) => state.attempts.get(n)).filter(Boolean).sort((a, b) => b.peak - a.peak)[0];

  // ---------- routing ----------
  function readRoute() {
    const m = location.hash.match(/^#\/attempt\/(\d+)/);
    state.route = m ? { view: 'detail', n: Number(m[1]) } : { view: 'browse' };
  }
  window.addEventListener('hashchange', () => {
    readRoute();
    render();
    window.scrollTo(0, 0);
    document.getElementById('main').focus({ preventScroll: true });
  });

  // ---------- render: shared ----------
  function render() {
    if (!state.loaded) return;
    renderUpdated();
    renderNav();
    const main = document.getElementById('main');
    const chat = document.getElementById('chat');
    document.getElementById('navBrowse').classList.toggle('on', state.route.view === 'browse');
    if (state.route.view === 'detail' && state.attempts.has(state.route.n)) {
      const a = state.attempts.get(state.route.n);
      chat.hidden = false;
      if (state.shown !== a.n) {
        state.shown = a.n;
        state.chatKind = 'all';
        state.chatQuery = '';
        state.source = a.timelapse ? 'timelapse' : 'live';
        state.seen = new Set(a.moves.map(moveKey));
        main.replaceChildren(detailSkeleton(a));
        chat.replaceChildren(...chatSkeleton(a));
        document.title = `Attempt ${a.n} · Claudeville TV`;
      }
      fillDetail(a);
      fillChat(a);
    } else {
      state.shown = null;
      chat.hidden = true;
      main.replaceChildren(browseView());
      document.title = 'Claudeville TV · Claude plays SimCity 2000';
    }
  }

  function renderUpdated() {
    const el = document.getElementById('updated');
    const a = liveAttempt();
    el.replaceChildren();
    if (a && a.updated) el.append(h('span', { class: 'dot', 'aria-hidden': 'true' }), `Attempt ${a.n} live · game updated ${ago(a.updated)}`);
  }

  function attemptLink(a, cls, ...kids) {
    return h('a', { class: cls, href: `#/attempt/${a.n}` }, ...kids);
  }
  function badge(a) {
    return h('span', { class: 'badge' + (a.live ? ' live' : ''), text: a.live ? 'LIVE' : (a.success ? 'GOAL MET' : 'ENDED') });
  }
  function title(a) {
    return a.live ? `Attempt ${a.n} · live in ${a.latest ? a.latest.date : 'progress'}` : `Attempt ${a.n} · peak ${fmt(a.peak)} people`;
  }
  function subtitle(a) {
    return a.live ? `${fmt(a.pop)} people · year ${Math.max(0, Math.floor(a.gy - START))} of 50` : `ended ${a.ended}`;
  }

  // ---------- left rail ----------
  function renderNav() {
    const nav = document.getElementById('nav');
    nav.classList.toggle('collapsed', state.navCollapsed);
    const open = !state.navCollapsed;
    const toggle = h('button', {
      class: 'icon-btn', type: 'button', 'aria-expanded': String(open),
      'aria-label': open ? 'Collapse attempts panel' : 'Expand attempts panel', title: open ? 'Collapse' : 'Expand',
      onClick: () => { state.navCollapsed = !state.navCollapsed; store('navCollapsed', state.navCollapsed ? '1' : '0'); renderNav(); },
    }, icon(open ? 'M13 5 L8 10 L13 15' : 'M8 5 L13 10 L8 15', 20, [s('line', { x1: 3, y1: 3, x2: 3, y2: 17, stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' })]));
    const items = state.list.map((n) => state.attempts.get(n)).filter(Boolean).map((a) => {
      const on = state.route.view === 'detail' && state.route.n === a.n;
      return attemptLink(a, 'side' + (on ? ' on' : ''),
        h('span', { class: 'avatar' }, h('img', { src: a.thumb, alt: '' }), a.live ? h('span', { class: 'livedot', 'aria-hidden': 'true' }) : null),
        h('span', { class: 'side-text' }, h('span', { class: 'side-name', text: `Attempt ${a.n}` }),
          h('span', { class: 'side-sub', text: a.live ? `Live · ${a.latest ? a.latest.date : ''}` : (a.reason || subtitle(a)) })),
        h('span', { class: 'side-stat' }, h('span', { class: 'dot' + (a.live ? ' live' : '') }), a.live ? 'live' : short(a.peak)));
    });
    items.forEach((el, i) => { const a = state.attempts.get(state.list[i]); el.setAttribute('aria-label', `Attempt ${a.n}, ${a.live ? 'live' : 'peak ' + fmt(a.peak)}`); el.title = `Attempt ${a.n}`; });
    nav.replaceChildren(
      h('div', { class: 'panel-head' }, h('span', { class: 'panel-title', text: 'ATTEMPTS' }), toggle),
      ...items,
      h('div', { class: 'nav-foot', text: 'Same flat map every attempt. Medium difficulty, disasters on, loans allowed. Up to 20 tries.' }));
  }

  // ---------- browse ----------
  function browseView() {
    const all = state.list.map((n) => state.attempts.get(n)).filter(Boolean);
    const lead = liveAttempt() || all[0];
    const top = best();
    const wrap = h('div', { class: 'browse' });
    if (lead) {
      const l = lead.latest || {};
      const jobless = l.graphs && l.graphs.unemployment ? l.graphs.unemployment[0] : null;
      const text = lead.live
        ? `${l.date || ''}: ${fmt(lead.pop)} people${jobless != null ? `, ${jobless}% jobless` : ''}, ${money(l.money)} in the bank. ${all.length - 1} earlier ${all.length - 1 === 1 ? 'try' : 'tries'}${top && top.n !== lead.n ? `; the best reached ${fmt(top.peak)} people (attempt ${top.n})` : ''}.`
        : lead.reason;
      wrap.append(h('section', { class: 'hero' },
        attemptLink(lead, 'hero-media',
          h('img', { src: lead.thumb, alt: `Attempt ${lead.n}, ${l.date || ''}: the city on screen` }),
          badge(lead),
          h('span', { class: 'play-overlay', 'aria-hidden': 'true' }, h('span', {}, s('svg', { width: 28, height: 28, viewBox: '0 0 28 28' }, s('path', { d: 'M9 5 L23 14 L9 23 Z', fill: '#fff' }))))),
        h('div', { class: 'hero-body' },
          h('div', { class: 'eyebrow', text: lead.live ? 'LIVE NOW' : 'LATEST ATTEMPT' }),
          h('h1', { text: lead.live ? `Attempt ${lead.n} · year ${Math.max(0, Math.floor(lead.gy - START))}` : title(lead) }),
          h('p', { text }),
          h('div', { class: 'tags' }, ['SimCity 2000', 'Claude Code', 'Medium', 'Disasters on'].map((t) => h('span', { class: 'tag', text: t }))),
          attemptLink(lead, 'btn', lead.live ? 'Watch live' : 'Watch'))));
    }
    wrap.append(h('section', { class: 'browse' },
      h('div', { class: 'section-head' }, h('h2', { text: 'All simulation videos' }), h('span', { class: 'muted', text: `${all.length} attempts · newest first` })),
      h('div', { class: 'grid' }, all.map(card))));
    return wrap;
  }

  function card(a) {
    return attemptLink(a, 'card',
      h('span', { class: 'thumb' },
        h('img', { src: a.thumb, alt: `Attempt ${a.n} city`, loading: 'lazy' }), badge(a),
        h('span', { class: 'corner l', text: a.live ? 'LIVE' : (a.timelapse ? 'TIMELAPSE' : 'RECORDINGS') }),
        h('span', { class: 'corner r', text: `peak ${fmt(a.peak)}` })),
      h('span', { class: 'card-meta' },
        h('img', { src: a.thumb, alt: '' }),
        h('span', { class: 'card-text' },
          h('span', { class: 'card-title', text: title(a) }),
          h('span', { class: 'card-sub', text: subtitle(a) }),
          a.reason || a.strategy ? h('span', { class: 'card-desc', text: a.live ? a.strategy : a.reason }) : null)));
  }

  // ---------- detail ----------
  function detailSkeleton(a) {
    return h('div', { class: 'detail' },
      h('a', { class: 'back', href: '#/' }, icon('M12 4 L6 10 L12 16', 16), 'All videos'),
      h('div', { id: 'player' }),
      h('div', { id: 'titleRow', class: 'title-row' }),
      h('div', { id: 'stats', class: 'stats' }),
      h('section', { class: 'box chart' },
        h('div', { class: 'section-head' }, h('h2', { text: 'Population vs. the pace to 100,000' }),
          h('div', { class: 'legend' },
            h('span', {}, s('svg', { width: 22, height: 4, 'aria-hidden': 'true' }, s('line', { x1: 0, y1: 2, x2: 22, y2: 2, style: 'stroke:var(--series)', 'stroke-width': 3 })), 'This attempt'),
            h('span', {}, s('svg', { width: 22, height: 4, 'aria-hidden': 'true' }, s('line', { x1: 0, y1: 2, x2: 22, y2: 2, style: 'stroke:var(--pace)', 'stroke-width': 2, 'stroke-dasharray': '4 3' })), 'Pace needed'))),
        h('div', { id: 'chart' })),
      h('section', { class: 'box' },
        h('div', { class: 'section-head' }, h('h2', { text: 'Game data' }), h('span', { class: 'muted', text: 'From the save file · newest first · one row per game year' })),
        h('div', { id: 'table', class: 'scroll' })),
      h('section', { id: 'whySection', class: 'box' }),
      h('section', { class: 'browse' }, h('h2', { text: 'Chapters' }), h('div', { id: 'chapters', class: 'browse', style: 'gap:12px' })),
      h('section', { class: 'browse' }, h('h2', { text: 'More from Claudeville 3' }), h('div', { id: 'more', class: 'grid small' })));
  }

  function fillDetail(a) {
    fillPlayer(a);
    const l = a.latest || {};
    const out = a.live ? ['live', 'Live · year ' + Math.max(0, Math.floor(a.gy - START)) + ' of 50'] : a.success ? ['good', 'Goal met'] : ['', 'Missed'];
    document.getElementById('titleRow').replaceChildren(
      h('div', { class: 'title-main' }, h('img', { src: a.thumb, alt: '' }),
        h('div', {}, h('h1', { text: title(a) }), h('div', { class: 'channel', text: `Claudeville 3 · Attempt ${a.n}` }),
          h('div', { class: 'tags', style: 'margin-top:6px' }, (a.live ? ['Live'] : []).concat(['SimCity 2000', 'Medium', 'Disasters on']).map((t) => h('span', { class: 'tag', text: t }))))),
      h('span', { class: 'outcome ' + out[0], text: out[1] }));

    const last = a.rows[a.rows.length - 1] || {};
    const stats = a.live
      ? [['Population', fmt(a.pop), 'of 100,000'], ['Pace needed now', fmt(pace(a.gy)), a.pop >= pace(a.gy) ? 'ahead of pace' : 'behind pace'],
        ['Cash', money(l.money), l.date || ''], ['Loans', fmt(l.bonds), 'bonds out'], ['Game year', String(Math.max(0, Math.floor(a.gy - START))), 'of 50']]
      : [['Peak population', fmt(a.peak), a.peakDate], ['Pace at that date', fmt(pace(gyOf(a, a.peakDate))), a.peak >= pace(gyOf(a, a.peakDate)) ? 'ahead of pace' : 'behind pace'],
        ['Game years', String(Math.max(0, Math.round(a.gy - START))), 'of 50'], ['Loans at the end', fmt(last.bonds), 'bonds out'], ['Recordings', String(a.parts.length), '30-min parts']];
    document.getElementById('stats').replaceChildren(...stats.map(([lab, v, note]) =>
      h('div', { class: 'stat' }, h('span', { class: 'stat-l', text: lab }), h('span', { class: 'stat-v', text: v }), h('span', { class: 'stat-n', text: note }))));

    document.getElementById('chart').replaceChildren(chart(a));
    document.getElementById('table').replaceChildren(table(a));
    fillWhy(a);
    const ch = document.getElementById('chapters');
    ch.replaceChildren(...(a.yearly.length ? a.yearly.slice().reverse().map(chapter) : [h('p', { class: 'empty', text: 'Chapters appear here as each game year ends.' })]));
    document.getElementById('more').replaceChildren(...state.list.filter((n) => n !== a.n).map((n) => state.attempts.get(n)).filter(Boolean).map(card));
  }

  function gyOf(a, date) {
    const r = a.rows.find((x) => x.date === date);
    return r ? r.gy : a.gy;
  }

  function sources(a) {
    const list = [];
    if (a.live) list.push({ key: 'live', label: 'Live view' });
    if (a.timelapse) list.push({ key: 'timelapse', label: 'Timelapse' });
    return list.concat(a.parts);
  }

  function fillPlayer(a) {
    const box = document.getElementById('player');
    const srcs = sources(a);
    if (!srcs.some((x) => x.key === state.source)) state.source = srcs.length ? srcs[0].key : 'live';
    const cur = srcs.find((x) => x.key === state.source) || { key: 'live' };
    const key = a.n + ':' + cur.key;
    if (box.dataset.key === key) {
      // Same source: only refresh the live image and the source list (new parts may have arrived).
      const img = box.querySelector('img.liveimg');
      if (img) img.src = a.thumb;
      const note = box.querySelector('.player-note');
      if (note && cur.key === 'live') note.textContent = liveNote(a);
      box.querySelector('.sources').replaceChildren(...sourceChips(a, srcs));
      return;
    }
    box.dataset.key = key;
    let media;
    if (cur.key === 'live') {
      media = h('div', { class: 'player' }, h('img', { class: 'liveimg', src: a.thumb, alt: `Attempt ${a.n}, latest screenshot of the game` }), badge(a));
    } else {
      const src = cur.key === 'timelapse' ? a.timelapse : cur.src;
      media = h('div', { class: 'player' }, h('video', { controls: true, preload: 'metadata', playsinline: true, src, poster: a.thumb, 'aria-label': `Attempt ${a.n} ${cur.label.toLowerCase()}` }));
    }
    const note = cur.key === 'live' ? liveNote(a)
      : cur.key === 'timelapse' ? 'Timelapse of the whole attempt, sped up. The top bar shows the game date, population and cash.'
        : `${cur.label} of the full recording (about 30 minutes, real speed).`;
    box.replaceChildren(h('div', { class: 'browse', style: 'gap:8px' }, media,
      h('div', { class: 'sources', role: 'group', 'aria-label': 'Video' }, ...sourceChips(a, srcs)),
      h('span', { class: 'player-note', text: note })));
  }
  function liveNote(a) {
    return `Latest screenshot from the game (${a.latest ? a.latest.date : ''}). It refreshes every few minutes; finished recordings appear as parts.`;
  }
  function sourceChips(a, srcs) {
    return srcs.map((x) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(x.key === state.source), text: x.label,
      onClick: () => { state.source = x.key; fillPlayer(a); },
    }));
  }

  function chart(a) {
    const W = 600, H = 210, L = 44, R = 12, T = 14, B = 26;
    const pts = a.rows.map((r) => [r.gy, r.population]);
    const lastGy = pts.length ? pts[pts.length - 1][0] : START;
    const xMax = Math.min(DEADLINE, Math.max(2025, Math.ceil(lastGy) + 3));
    const top = Math.max(a.peak, pace(xMax)) * 1.08;
    const step = [5000, 10000, 20000, 25000, 50000].find((v) => top / v <= 5) || 50000;
    const yMax = Math.ceil(top / step) * step;
    const X = (g) => L + (g - START) / (xMax - START) * (W - L - R);
    const Y = (p) => T + (1 - p / yMax) * (H - T - B);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Attempt ${a.n} population by game year against the straight-line pace to 100,000 by 2050. Peak ${fmt(a.peak)}.` });
    const g = s('g', { 'font-family': 'JetBrains Mono, monospace', 'font-size': 10, style: 'fill:var(--muted)' });
    for (let v = 0; v <= yMax; v += step) {
      g.append(s('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), style: 'stroke:' + (v ? 'var(--border)' : 'var(--border-2)') }));
      g.append(s('text', { x: L - 6, y: Y(v) + 3, 'text-anchor': 'end' }, short(v)));
    }
    const yStep = xMax - START > 30 ? 10 : 5;
    for (let y = START; y <= xMax; y += yStep) g.append(s('text', { x: X(y), y: H - 8, 'text-anchor': y === START ? 'start' : 'middle' }, String(y)));
    svg.append(g);
    svg.append(s('line', { x1: X(START), y1: Y(0), x2: X(xMax), y2: Y(pace(xMax)), style: 'stroke:var(--pace)', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
    if (pts.length) {
      svg.append(s('polyline', { points: pts.map((p) => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' '), fill: 'none', style: 'stroke:var(--series)', 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      const e = pts[pts.length - 1];
      svg.append(s('circle', { cx: X(e[0]), cy: Y(e[1]), r: 4.5, style: 'fill:var(--series);stroke:var(--surface)', 'stroke-width': 2 }));
      svg.append(s('text', { x: Math.min(X(e[0]) + 8, W - 60), y: Y(e[1]) - 8, style: 'fill:var(--ink)', 'font-family': 'JetBrains Mono, monospace', 'font-size': 11 }, fmt(e[1])));
    }
    return svg;
  }

  function table(a) {
    const byYear = new Map();
    for (const r of a.rows) byYear.set(r.year, r);
    const rows = [...byYear.values()].reverse();
    if (!rows.length) return h('p', { class: 'empty', text: 'No data yet.' });
    const cell = (v, warn, cls) => h('td', { class: (cls || '') + (warn ? ' warn' : ''), text: v });
    return h('table', {},
      h('thead', {}, h('tr', {}, ['Date', 'People', 'Cash', 'Loans', 'Jobless', 'Watered', 'Powered', 'Abandoned', 'Jammed roads'].map((t) => h('th', { scope: 'col', text: t })))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        cell(r.date), cell(fmt(r.population), false, 'pop'), cell(money(r.money), r.money < 500),
        cell(fmt(r.bonds)), cell((r.unemployment ?? '–') + '%', r.unemployment >= 20),
        cell((r.watered_pct ?? '–') + '%', r.population > 0 && r.watered_pct < 80),
        cell((r.powered_pct ?? '–') + '%', r.population > 0 && r.powered_pct < 90),
        cell(fmt(r.abandoned), r.abandoned > 300), cell(fmt(r.jammed), r.jammed > 10)))));
  }

  function chapter(y) {
    const tone = y.tone || 'steady';
    const nums = [];
    if (y.start && y.end) {
      nums.push(`People ${fmt(y.start.population)} → ${fmt(y.end.population)}`);
      nums.push(`Cash ${money(y.start.money)} → ${money(y.end.money)}`);
      nums.push(`Jobless ${y.end.unemployment}% · loans ${y.end.bonds}`);
    }
    return h('article', { class: 'chapter' },
      h('div', { class: 'chapter-when' }, h('b', { text: String(y.year) }), h('span', { class: 'tone ' + tone, text: tone[0].toUpperCase() + tone.slice(1) })),
      h('div', { class: 'chapter-body' }, h('h3', { text: y.title || '' }), h('p', { text: y.happened || '' }),
        y.watching ? h('p', { class: 'watch', text: 'Watching next: ' + y.watching }) : null),
      nums.length ? h('div', { class: 'chapter-nums', text: nums.join('\n') }) : null);
  }

  function fillWhy(a) {
    const sec = document.getElementById('whySection');
    if (a.live) {
      sec.replaceChildren(h('h2', { text: 'Plan for this attempt' }), h('p', { class: 'summary', text: a.strategy || 'Claude has not posted its plan yet.' }),
        h('a', { href: a.dash, target: '_blank', rel: 'noopener', text: 'Open the full live dashboard' }));
      return;
    }
    const pm = a.postMortem;
    sec.replaceChildren(h('h2', { text: 'Why it ended' }),
      pm && pm.summary ? h('p', { class: 'summary', text: pm.summary }) : h('p', { class: 'summary', text: a.reason || 'Post-mortem not written yet.' }),
      ...(pm ? pm.causes.map((c, i) => h('div', { class: 'cause' }, h('span', { class: 'cause-n', text: String(i + 1) }), h('div', {}, h('b', { text: c.title }), h('span', { text: c.text })))) : []),
      a.postMortemUrl ? h('a', { href: a.postMortemUrl, target: '_blank', rel: 'noopener', text: 'Read the full post-mortem' }) : null);
  }

  // ---------- agent chat ----------
  const moveKey = (m) => (m.t || '') + '|' + (m.text || '');
  const kindOf = (m) => (KINDS.includes(m.type) ? m.type : 'other');

  function chatSkeleton(a) {
    const chat = document.getElementById('chat');
    chat.classList.toggle('collapsed', state.chatCollapsed);
    const toggle = () => {
      state.chatCollapsed = !state.chatCollapsed;
      store('chatCollapsed', state.chatCollapsed ? '1' : '0');
      chat.classList.toggle('collapsed', state.chatCollapsed);
      const b = chat.querySelector('.chat-head .icon-btn');
      b.setAttribute('aria-expanded', String(!state.chatCollapsed));
      b.setAttribute('aria-label', state.chatCollapsed ? 'Expand agent chat' : 'Collapse agent chat');
      b.replaceChildren(chevron());
    };
    const chevron = () => icon(state.chatCollapsed ? 'M12 5 L7 10 L12 15' : 'M7 5 L12 10 L7 15', 20, [s('line', { x1: 17, y1: 3, x2: 17, y2: 17, stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' })]);
    const search = h('input', { id: 'chatSearch', type: 'search', placeholder: "Search Claude's moves", autocomplete: 'off',
      onInput: (e) => { state.chatQuery = e.target.value; fillChat(a, true); } });
    return [
      h('div', { class: 'chat-head' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-expanded': String(!state.chatCollapsed), 'aria-label': state.chatCollapsed ? 'Expand agent chat' : 'Collapse agent chat', onClick: toggle }, chevron()),
        h('span', { class: 't', text: 'AGENT CHAT' }), h('span', { id: 'chatNote', class: 'n' })),
      h('button', { class: 'chat-rail', type: 'button', 'aria-label': 'Expand agent chat', onClick: toggle },
        s('svg', { width: 20, height: 20, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, s('path', { d: 'M3 2 H13 V11 H8 L5 14 V11 H3 Z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linejoin': 'round' })),
        h('span', { text: 'AGENT CHAT' })),
      h('div', { class: 'chat-body' },
        h('div', { id: 'pinned', class: 'pinned' }),
        h('div', { id: 'chips', class: 'chips', role: 'group', 'aria-label': 'Filter by move type' }),
        h('div', { id: 'msgs', class: 'msgs', 'aria-live': a.live ? 'polite' : 'off' }),
        h('div', { class: 'chat-foot' },
          h('label', { for: 'chatSearch', text: 'Search moves by word or year (e.g. pumps, loan, 2011)' }),
          h('div', { class: 'row' }, search, h('button', { type: 'button', class: 'btn ghost', text: 'Clear', onClick: () => { state.chatKind = 'all'; state.chatQuery = ''; search.value = ''; fillChat(a, true); } })),
          h('span', { id: 'chatCount', class: 'count' }))),
    ];
  }

  function fillChat(a, userAction) {
    const msgs = document.getElementById('msgs');
    if (!msgs) return;
    document.getElementById('chatNote').textContent = a.live ? 'live' : `${a.moves.length} moves`;
    document.getElementById('pinned').replaceChildren(
      s('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true', style: 'flex:0 0 16px;margin-top:2px' }, s('path', { d: 'M3 2 H13 V11 H8 L5 14 V11 H3 Z', fill: 'none', style: 'stroke:var(--accent)', 'stroke-width': 1.5, 'stroke-linejoin': 'round' })),
      h('span', {}, h('b', { text: 'Pinned plan: ' }), a.strategy || 'Not posted yet.'));

    const counts = {};
    for (const m of a.moves) counts[kindOf(m)] = (counts[kindOf(m)] || 0) + 1;
    const kinds = ['all'].concat(KINDS.filter((k) => counts[k]), counts.other ? ['other'] : []);
    if (!kinds.includes(state.chatKind)) state.chatKind = 'all';
    document.getElementById('chips').replaceChildren(...kinds.map((k) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(state.chatKind === k),
      onClick: () => { state.chatKind = k; fillChat(a, true); },
    }, k === 'all' ? 'All' : (KIND_LABEL[k] || 'Other'), h('span', { class: 'c', text: String(k === 'all' ? a.moves.length : counts[k]) }))));

    const q = state.chatQuery.trim().toLowerCase();
    const shown = a.moves.filter((m) => (state.chatKind === 'all' || kindOf(m) === state.chatKind)
      && (!q || `${m.text} ${m.date} ${m.type}`.toLowerCase().includes(q)));
    const atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 40;
    const first = !msgs.dataset.filled;
    msgs.replaceChildren(...(shown.length ? shown.map((m) => {
      const k = kindOf(m), key = moveKey(m);
      const isNew = !state.seen.has(key);
      state.seen.add(key);
      return h('div', { class: 'msg' + (isNew && !userAction ? ' new' : '') },
        h('time', { text: m.date || '' }), h('span', { class: 'kind k-' + k, text: (KIND_LABEL[k] || m.type || 'note').toLowerCase() }),
        h('span', { class: 'who w-' + k, text: 'Claude:' }), h('span', { class: 'txt', text: m.text || '' }));
    }) : [h('p', { class: 'empty', style: 'padding:16px 8px' }, 'No moves match. ', h('button', { type: 'button', class: 'chip', text: 'Clear filters', onClick: () => { state.chatKind = 'all'; state.chatQuery = ''; document.getElementById('chatSearch').value = ''; fillChat(a, true); } }))]));
    msgs.dataset.filled = '1';
    if (first || atBottom || userAction) msgs.scrollTop = msgs.scrollHeight;
    document.getElementById('chatCount').textContent = `Showing ${shown.length} of ${a.moves.length} moves · newest at the bottom`;
  }

  // ---------- theme ----------
  function renderTheme() {
    const dark = document.documentElement.dataset.theme === 'dark';
    const btn = document.getElementById('themeBtn');
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = btn.getAttribute('aria-label');
    btn.replaceChildren(dark
      ? icon('M10 2 V4 M10 16 V18 M2 10 H4 M16 10 H18 M4.3 4.3 L5.7 5.7 M14.3 14.3 L15.7 15.7 M4.3 15.7 L5.7 14.3 M14.3 5.7 L15.7 4.3', 20, [s('circle', { cx: 10, cy: 10, r: 3.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 })])
      : icon('M16 12.5 A7 7 0 1 1 7.5 4 A5.5 5.5 0 0 0 16 12.5 Z'));
    document.querySelector('meta[name=theme-color]').setAttribute('content', dark ? '#0F0F12' : '#FFFFFF');
  }
  document.getElementById('themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store('theme', next);
    renderTheme();
  });
  renderTheme();

  // ---------- start ----------
  readRoute();
  refresh();
  setInterval(refresh, POLL_MS);
  setInterval(renderUpdated, 30 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
