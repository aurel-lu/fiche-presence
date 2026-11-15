/* Fiche de présence — interface. Le calcul et la lecture de l'Excel sont dans core.js. */
(function () {
  'use strict';

  const C = window.Core;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const DAYS_FULL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const KEYS = { abs: 'fiche-presence.absences.v1', tt: 'fiche-presence.timetable.v1', set: 'fiche-presence.settings.v1' };
  const ABS_KEY = /^\d{4}-\d{2}-\d{2}#\d{1,2}$/;

  const svg = (body, size, vb) => `<svg viewBox="0 0 ${vb || 24} ${vb || 24}" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  const ICON = {
    left: svg('<path d="M15 5l-7 7 7 7"/>', 22),
    right: svg('<path d="M9 5l7 7-7 7"/>', 22),
    down: svg('<path d="M6 9l6 6 6-6"/>', 14),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>', 20),
    menu: svg('<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.6"/><circle cx="8" cy="17" r="2.6"/>', 22),
    today: svg('<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4"/><circle cx="12" cy="13.5" r="2" fill="currentColor" stroke="none"/>', 22),
    lock: '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" focusable="false"><rect x="3" y="7" width="10" height="7" rx="1.6" fill="currentColor"/><path d="M5.3 7V5.1a2.7 2.7 0 015.4 0V7" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
    // verdicts : une forme par état, pour ne jamais dépendre de la couleur seule
    ok: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="7.2" fill="currentColor"/><path d="M4.7 8.3l2.2 2.2 4.4-4.9" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    last: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M8 1.9l6.6 11.7H1.4z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6.2v3.4" stroke="#0b0b0b" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11.7" r="1" fill="#0b0b0b"/></svg>',
    locked: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><rect x="2.4" y="6.8" width="11.2" height="8" rx="2" fill="currentColor"/><path d="M5 6.8V5a3 3 0 016 0v1.8" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    over: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="7.2" fill="currentColor"/><path d="M5.4 5.4l5.2 5.2M10.6 5.4l-5.2 5.2" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>',
    done: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 8h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  };

  /* ───────── état ───────── */

  const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const drop = k => { try { localStorage.removeItem(k); } catch (e) { /* rien */ } };
  const cleanAbsences = o => {
    const out = {};
    if (o && typeof o === 'object') Object.keys(o).forEach(k => { if (ABS_KEY.test(k) && (o[k] === 'A' || o[k] === 'J')) out[k] = o[k]; });
    return out;
  };
  const validTimetable = t => !!(t && Array.isArray(t.weeks) && t.weeks.length && Array.isArray(t.times) &&
    t.weeks.every(w => w && /^\d{4}-\d{2}-\d{2}$/.test(w.monday) && Array.isArray(w.days)));

  const DEFAULT_TT = window.DEFAULT_TIMETABLE;
  let custom = load(KEYS.tt, null);
  if (!validTimetable(custom)) custom = null;
  let tt = custom || DEFAULT_TT;
  let absences = cleanAbsences(load(KEYS.abs, {}));
  const settings = Object.assign({ base: 'strict' }, load(KEYS.set, {}));
  if (['strict', 'planned', 'official'].indexOf(settings.base) < 0) settings.base = 'strict';

  let sessions = [], byId = {}, stats = null, hasSat = false;
  let weekIndex = 0, followHome = true, selected = null, pending = null, swipedAt = 0, toastTimer = 0;

  function model() {
    sessions = C.listSessions(tt);
    byId = {}; sessions.forEach(s => { byId[s.id] = s; });
    hasSat = tt.weeks.some(w => (w.days[5] || []).length > 0);
    stats = C.computeStats(tt, absences, settings.base, C.nowInfo());
  }
  const persistAbsences = () => { if (!save(KEYS.abs, absences)) toast("Impossible d'enregistrer sur cet appareil (stockage plein ou navigation privée)."); };

  /* ───────── semaines ───────── */

  function homeWeekIndex() {            // la semaine à montrer à l'ouverture ; le week-end, celle qui vient
    const d = new Date(), dow = d.getDay();
    let iso = C.localIso(d);
    if (dow === 0) iso = C.addDays(iso, 1); else if (dow === 6 && !hasSat) iso = C.addDays(iso, 2);
    let idx = 0;
    tt.weeks.forEach((w, i) => { if (w.monday <= iso) idx = i; });
    return idx;
  }
  function relLabel(i) {
    const today = C.localIso(new Date()), m = tt.weeks[i].monday;
    if (m <= today && today <= C.addDays(m, 6)) return 'cette semaine';
    if (C.addDays(m, -7) <= today && today < m) return 'semaine prochaine';
    if (C.addDays(m, 7) <= today && today <= C.addDays(m, 13)) return 'semaine dernière';
    return '';
  }
  function weekLabel(w) {
    const a = w.monday.split('-').map(Number), b = C.addDays(w.monday, 4).split('-').map(Number);
    const d = n => (n === 1 ? '1er' : String(n));
    return a[1] === b[1] ? `${d(a[2])} – ${d(b[2])} ${C.MONTHS[b[1] - 1]}` : `${d(a[2])} ${C.MONTHS[a[1] - 1]} – ${d(b[2])} ${C.MONTHS[b[1] - 1]}`;
  }
  const weekMinutes = i => sessions.reduce((a, s) => a + (s.wi === i ? s.m : 0), 0);
  const weekMarks = i => sessions.reduce((a, s) => a + (s.wi === i && absences[s.id] ? 1 : 0), 0);

  function go(i) {
    weekIndex = Math.max(0, Math.min(tt.weeks.length - 1, i));
    followHome = weekIndex === homeWeekIndex();
    renderWeek();
  }

  /* ───────── grille de la semaine ───────── */

  // « Data (WZ) info » → « WZ · info » ; « SGSE-AAV1 (PK) » → « AAV1 · PK »
  function detail(b, sub) {
    const parts = [];
    b.t.replace(sub.re, '').replace(/(\d{1,2})\s*h\s*(\d{2})?\s*$/i, '').replace(/\(([^)]*)\)|([^()]+)/g, (m, inPar, out) => {
      const t = (inPar !== undefined ? inPar : out).replace(/^[\s\-–:·]+|[\s\-–:·]+$/g, '');
      if (t) parts.push(t);
      return '';
    });
    if (b.m !== C.SLOT_MIN * b.n) parts.push(C.fmtH(b.m));
    return parts.join(' · ');
  }
  const offLabel = t => (/^vacances/i.test(t) ? 'Vacances' : /^f[ée]ri/i.test(t) ? 'Férié' : t);

  function renderWeek() {
    const w = tt.weeks[weekIndex], S = tt.nSlots || 4, nDays = hasSat ? 6 : 5;
    const morning = Math.ceil(S / 2);                       // la pause de midi suit ces créneaux
    const rowOf = s => 2 + s + (s >= morning ? 1 : 0);
    const place = (d, span, s, n) => `grid-column:${d + 2}/span ${span};grid-row:${rowOf(s)}/${rowOf(s + n - 1) + 1}`;
    const now = C.nowInfo(), today = now.date, home = homeWeekIndex(), rel = relLabel(weekIndex);
    const baseTimes = (tt.times && tt.times[0]) || C.DEFAULT_TIMES;

    $('wkTitle').innerHTML = esc(weekLabel(w)) + ICON.down;
    $('wkSub').textContent = `Semaine ${weekIndex + 1} sur ${tt.weeks.length}` + (rel ? ` · ${rel}` : '');
    $('prev').disabled = weekIndex === 0;
    $('next').disabled = weekIndex === tt.weeks.length - 1;
    $('today').hidden = weekIndex === home;

    const sameFullDay = (a, b) => !!a && a.length === 1 && a[0].k !== 'c' && a[0].n === S && a[0].k === b.k && a[0].t === b.t;
    let html = '';
    for (let d = 0; d < nDays; d++) {
      const iso = C.addDays(w.monday, d);
      html += `<div class="dh${iso === today ? ' today' : ''}" style="grid-column:${d + 2}"><span>${DAYS[d]}</span><b>${+iso.slice(8)}</b></div>`;
    }
    for (let s = 0; s < S; s++) html += `<div class="th" style="grid-row:${rowOf(s)}">${C.fmtTime((baseTimes[s] || C.DEFAULT_TIMES[s] || [0])[0])}</div>`;

    for (let d = 0; d < nDays; d++) {
      const blocks = w.days[d] || [], iso = C.addDays(w.monday, d);
      const only = blocks.length === 1 && blocks[0].k !== 'c' && blocks[0].n === S ? blocks[0] : null;
      if (only) {                                           // journées entières identiques : un seul grand bloc
        if (d > 0 && sameFullDay(w.days[d - 1], only)) continue;
        let span = 1;
        while (d + span < nDays && sameFullDay(w.days[d + span], only)) span++;
        html += plainCell(only, place(d, span, 0, S), span >= 3);
        continue;
      }
      blocks.forEach(b => {
        if (b.k !== 'c') { html += plainCell(b, place(d, 1, b.s, b.n), false); return; }
        const id = `${iso}#${b.s}`, se = byId[id], sub = C.SUBJECT_BY_ID[b.sub];
        if (!se || !sub) return;
        const st = absences[id], past = C.isPast(se, now), locked = !st && !!stats.locked[id];
        const cls = ['cell', 'course', 's-' + sub.id];
        let word = 'présent', state = '';
        if (st === 'A') { cls.push('is-a', past ? 'past' : 'fut'); word = past ? 'absent' : 'absence prévue'; state = past ? 'Absent' : 'Prévu'; }
        else if (st === 'J') { cls.push('is-j'); word = 'absence justifiée'; state = 'Justifiée'; }
        if (locked) cls.push('is-locked');
        const det = detail(b, sub);
        const time = ((tt.times && tt.times[d]) || baseTimes)[b.s] || C.DEFAULT_TIMES[b.s] || [0];
        const aria = `${DAYS_FULL[d]} ${C.fmtDay(iso)}, ${C.fmtTime(time[0])}, ${b.t}, ${C.fmtH(b.m)} : ${word}` + (locked ? ', marge épuisée' : '');
        html += `<button type="button" class="${cls.join(' ')}" data-id="${id}" style="${place(d, 1, b.s, b.n)}" aria-label="${esc(aria)}">` +
          `<span class="c-name">${esc(sub.short)}</span>` +
          (state ? `<span class="c-state">${state}</span>` : det ? `<span class="c-det">${esc(det)}</span>` : '') +
          (locked ? `<span class="c-lock">${ICON.lock}</span>` : '') + '</button>';
      });
    }
    const grid = $('grid');
    grid.style.setProperty('--days', nDays);
    grid.style.gridTemplateRows = `auto repeat(${morning}, var(--rowh))${S > morning ? ` 8px repeat(${S - morning}, var(--rowh))` : ''}`;
    grid.innerHTML = html;

    $('key').innerHTML = '<span><i class="k-a"></i>Absent</span><span><i class="k-j"></i>Justifiée, non comptée</span>' +
      `<span><i class="k-l">${ICON.lock}</i>Marge épuisée</span>`;
    // horaires propres à un jour (le vendredi après-midi est décalé)
    const notes = [];
    for (let d = 1; d < nDays; d++) {
      const t = tt.times && tt.times[d]; if (!t) continue;
      const diff = []; for (let s = 0; s < S; s++) if (t[s] && baseTimes[s] && t[s][0] !== baseTimes[s][0]) diff.push(s);
      if (diff.length) notes.push(`${DAYS_FULL[d]} : ${diff.map(s => C.fmtTime(t[s][0])).join(' et ')} au lieu de ${diff.map(s => C.fmtTime(baseTimes[s][0])).join(' et ')}.`);
    }
    $('hint').textContent = 'Toucher un cours : absent, puis justifiée, puis présent. ' + notes.join(' ');
  }
  function plainCell(b, style, wide) {
    if (b.k === 'o') return `<div class="cell off${wide ? ' wide' : ''}" style="${style}">${esc(offLabel(b.t))}</div>`;
    // une coupure possible après « / » : « Stage/poursuite » ne tient pas sur une ligne de téléphone
    return `<div class="cell info" style="${style}"><span class="c-name">${esc(b.t).replace(/\//g, '/&#8203;')}</span></div>`;
  }

  /* ───────── bilan : camembert, proportion, marges ───────── */

  function sector(a0, a1) {
    const R = 57, r = 36, cx = 60, cy = 60;
    if (a1 - a0 >= 2 * Math.PI - 1e-6) {
      return `M${cx - R} ${cy}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0ZM${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
    }
    const p = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${p(R, a0)}A${R} ${R} 0 ${large} 1 ${p(R, a1)}L${p(r, a1)}A${r} ${r} 0 ${large} 0 ${p(r, a0)}Z`;
  }

  function renderPie() {
    const items = stats.subjects.filter(s => s.counted > 0), total = stats.total.counted;
    if (selected && !items.some(s => s.id === selected)) selected = null;
    let paths = '', legend = '', a0 = -Math.PI / 2;
    items.forEach(it => {
      const sub = C.SUBJECT_BY_ID[it.id], frac = it.counted / total, a1 = a0 + frac * 2 * Math.PI;
      const pct = Math.round(frac * 100) + ' %', on = selected === it.id ? ' sel' : '';
      const label = `${sub.name} : ${C.fmtH(it.counted)}, soit ${pct} des heures manquées`;
      paths += `<path class="slice s-${it.id}${items.length === 1 ? ' solo' : ''}${on}" data-sub="${it.id}" d="${sector(a0, a1)}" fill-rule="evenodd" tabindex="0" role="button" aria-label="${esc(label)}"><title>${esc(label)}</title></path>`;
      legend += `<li><button type="button" class="lg s-${it.id}${on}" data-sub="${it.id}" aria-pressed="${selected === it.id}"><i class="sw"></i><span class="lg-n">${esc(sub.mid)}</span><span class="lg-v">${C.fmtH(it.counted)}</span><span class="lg-p">${pct}</span></button></li>`;
      a0 = a1;
    });
    const cur = selected && items.find(s => s.id === selected);
    const big = C.fmtH(cur ? cur.counted : total);
    const small = cur ? `${C.SUBJECT_BY_ID[cur.id].short} · ${Math.round(cur.counted / total * 100)} %` : total > 60 ? 'manquées' : 'manquée';
    const just = stats.total.justified;
    $('pieCard').innerHTML =
      '<div class="card-head"><h2>Heures manquées par matière</h2></div><div class="pie-wrap">' +
      `<div class="pie${selected ? ' has-sel' : ''}"><svg viewBox="0 0 120 120" role="group" aria-label="Répartition des heures manquées par matière">` +
      (items.length ? paths : '<circle class="ring-empty" cx="60" cy="60" r="46.5"/>') + '</svg>' +
      `<div class="pie-center"><strong${big.length > 5 ? ' style="font-size:17px"' : ''}>${big}</strong><span>${esc(small)}</span></div></div>` +
      (items.length ? `<ul class="legend">${legend}</ul>` : '<p class="empty">Aucune absence comptée pour l’instant. Toucher un cours dans la semaine pour le marquer absent.</p>') +
      '</div>' + (just ? `<p class="note">En plus : ${C.fmtH(just)} d’absences justifiées, non comptées.</p>` : '');
  }

  function renderHero() {
    const t = stats.total;
    $('heroCard').innerHTML =
      `<div class="card-head"><h2>Sur le semestre</h2><small>${C.fmtH(t.counted)} sur ${C.fmtH(t.ref)}</small></div>` +
      `<div class="hero"><strong>${C.fmtPct(t.pct)}</strong><span>des heures de cours manquées</span></div>` +
      `<dl class="mini"><div><dt>Déjà manquées</dt><dd>${C.fmtH(t.absPast)}</dd></div><div><dt>Prévues</dt><dd>${C.fmtH(t.absFuture)}</dd></div>` +
      `<div><dt>Justifiées</dt><dd>${C.fmtH(t.justified)}</dd></div></dl>`;
  }

  function verdict(s) {
    const n = s.canMiss, seances = n ? `soit ${n} séance${n > 1 ? 's' : ''}` : '';
    switch (s.status) {
      case 'ok': return [`Encore ${C.fmtH(s.remaining)} de marge`, seances];
      case 'last': return ['Dernière absence possible', `marge de ${C.fmtH(s.remaining)}`];
      case 'locked': return ['Plus aucune absence possible', s.remaining > 1e-6 ? `il reste ${C.fmtH(s.remaining)}, moins qu’une séance` : 'limite atteinte'];
      case 'over': return [`Limite dépassée de ${C.fmtH(-s.remaining)}`, `${C.fmtPct(s.pct)} d’absence`];
      case 'done': return ['Matière terminée', `${C.fmtPct(s.pct)} d’absence`];
      default: return ['Aucune séance planifiée', ''];
    }
  }
  function renderMeters() {
    const rows = stats.subjects.map(s => {
      const sub = C.SUBJECT_BY_ID[s.id], scale = Math.max(s.limit, s.counted) || 1, v = verdict(s);
      const extra = [v[1]];
      if (s.absFuture > 0) extra.push(`dont ${C.fmtH(s.absFuture)} à venir`);
      if (s.justified > 0) extra.push(`${C.fmtH(s.justified)} justifiées`);
      const tail = extra.filter(Boolean).join(' · ');
      const bar = (s.absPast > 0 ? `<span class="m-fill" style="width:${(s.absPast / scale * 100).toFixed(2)}%"></span>` : '') +
        (s.absFuture > 0 ? `<span class="m-fill fut" style="width:${(s.absFuture / scale * 100).toFixed(2)}%"></span>` : '');
      return `<li class="st-${s.status}"><div class="m-head"><i class="sw s-${s.id}"></i><span class="m-name">${esc(sub.name)}</span>` +
        `<span class="m-fig"><b>${C.fmtH(s.counted)}</b> / ${C.fmtH(s.limit)}</span></div>` +
        `<div class="m-bar" role="img" aria-label="${esc(`${sub.name} : ${C.fmtH(s.counted)} manquées sur ${C.fmtH(s.limit)} autorisées`)}">${bar}</div>` +
        `<div class="m-foot">${ICON[s.status] || ICON.done}<span>${esc(v[0])}${tail ? ` <em>· ${esc(tail)}</em>` : ''}</span></div></li>`;
    }).join('');
    const baseTxt = { strict: 'le plus petit volume entre l’Excel et le PDF officiel', planned: 'les heures planifiées dans l’Excel', official: 'les volumes officiels du PDF' }[settings.base];
    $('meterCard').innerHTML =
      '<div class="card-head"><h2>Marge d’absence par matière</h2><small>20 % maximum</small></div>' +
      `<ul class="meters">${rows}</ul><p class="note">Jauge : heures manquées sur les heures autorisées (20 % du volume de la matière, base : ${baseTxt}). Les absences justifiées ne comptent pas.</p>`;
  }
  function renderStats() { renderPie(); renderHero(); renderMeters(); }
  function render() { renderWeek(); renderStats(); }

  /* ───────── marquer une absence ───────── */

  function cycle(id) {
    const se = byId[id]; if (!se) return;
    const before = stats.subjects.find(s => s.id === se.sub).status;
    if (!absences[id]) absences[id] = 'A'; else if (absences[id] === 'A') absences[id] = 'J'; else delete absences[id];
    persistAbsences();
    model(); render();
    const btn = $('grid').querySelector(`[data-id="${id}"]`);
    if (btn) btn.focus({ preventScroll: true });
    const after = stats.subjects.find(s => s.id === se.sub), name = C.SUBJECT_BY_ID[se.sub].name;
    if (after.status === before) return;
    if (after.status === 'over') toast(`${name} : limite de 20 % dépassée (${C.fmtH(after.counted)} manquées pour ${C.fmtH(after.limit)} autorisées).`);
    else if (after.status === 'locked') toast(`${name} : plus aucune absence possible sans dépasser 20 %.`);
    else if (after.status === 'last' && absences[id] === 'A') toast(`${name} : il ne reste qu’une absence possible.`);
  }
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
  }

  /* ───────── feuilles ───────── */

  const sheet = $('sheet');
  function openSheet(title, html) {
    sheet.innerHTML = `<div class="sheet-in"><div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="ibtn" data-act="close" aria-label="Fermer">${ICON.close}</button></div><div class="sheet-body">${html}</div></div>`;
    if (!sheet.open) { if (sheet.showModal) sheet.showModal(); else sheet.setAttribute('open', ''); }
    const body = sheet.querySelector('.sheet-body'); if (body) body.scrollTop = 0;
  }
  function closeSheet() {
    pending = null;
    if (sheet.open) { if (sheet.close) sheet.close(); else sheet.removeAttribute('open'); }
  }
  function confirmSheet(title, html, yesLabel, onYes, danger) {
    openSheet(title, `${html}<div class="btn-row"><button type="button" class="btn" data-act="close">Annuler</button>` +
      `<button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-act="yes">${esc(yesLabel)}</button></div>`);
    pending = onYes;
  }
  const message = (title, text) => openSheet(title, `<section class="set"><p>${esc(text)}</p><button type="button" class="btn primary" data-act="close">OK</button></section>`);

  function openWeekPicker() {
    const rows = tt.weeks.map((w, i) => {
      const min = weekMinutes(i), marks = weekMarks(i), rel = relLabel(i);
      const fullOff = w.days.slice(0, 5).every(bl => bl.length === 1 && bl[0].k === 'o');
      const sub = (fullOff ? offLabel(w.days[0][0].t) || 'Pas de cours' : min ? `${C.fmtH(min)} de cours suivis` : 'Aucun cours suivi') + (rel ? ` · ${rel}` : '');
      return `<button type="button" class="wrow${i === weekIndex ? ' cur' : ''}${fullOff ? ' is-off' : ''}" data-act="week" data-week="${i}"${i === weekIndex ? ' aria-current="true"' : ''}>` +
        `<span class="wr-t">${esc(weekLabel(w))}</span><span class="wr-s">${esc(sub)}</span>` +
        (marks ? `<span class="wr-b">${marks} absence${marks > 1 ? 's' : ''}</span>` : '') + '</button>';
    }).join('');
    openSheet('Choisir une semaine', rows);
    const cur = sheet.querySelector('.wrow.cur'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'center' });
  }

  function openSettings() {
    const first = tt.weeks[0].monday, last = C.addDays(tt.weeks[tt.weeks.length - 1].monday, 4);
    const src = custom
      ? `<b>${esc(custom.source || 'fichier importé')}</b>` + (custom.importedAt ? `, importé le ${esc(C.fmtDay(C.localIso(new Date(custom.importedAt))))}` : '')
      : `<b>${esc(DEFAULT_TT.source || 'version intégrée')}</b> (version intégrée à l’app)`;
    const sums = { strict: 0, planned: 0, official: 0 };
    stats.subjects.forEach(s => { sums.planned += s.planned; sums.official += s.official; sums.strict += Math.min(s.planned, s.official); });
    const opt = (id, title, text) => `<button type="button" role="radio" aria-checked="${settings.base === id}" data-act="base" data-base="${id}">` +
      `<span class="radio"></span><strong>${title}</strong><small>${text} Total : ${C.fmtH(sums[id])}.</small></button>`;
    const nAbs = Object.keys(absences).length;
    openSheet('Réglages',
      `<section class="set"><h3>Emploi du temps</h3><p>${src}. Du ${esc(C.fmtDay(first))} au ${esc(C.fmtDay(last))} : ${sessions.length} séances suivies.</p>` +
      '<button type="button" class="btn primary" data-act="import-xlsx">Importer un nouvel Excel (.xlsx)</button>' +
      (custom ? '<button type="button" class="btn" data-act="reset-tt">Revenir à la version intégrée</button>' : '') + '</section>' +
      '<section class="set"><h3>Base des 20 %</h3><p>Le volume d’heures de chaque matière sur lequel sont calculés les 20 %.</p><div class="seg" role="radiogroup" aria-label="Base des 20 %">' +
      opt('strict', 'Le plus strict des deux', 'Pour chaque matière, le plus petit volume entre l’Excel et le PDF officiel.') +
      opt('planned', 'Heures de l’Excel', 'Les créneaux réellement planifiés dans l’emploi du temps.') +
      opt('official', 'Volumes officiels', 'Les volumes du PDF de rentrée (GIPEX 60 h, Data 50 h…).') + '</div></section>' +
      `<section class="set"><h3>Sauvegarde</h3><p>${nAbs ? `${nAbs} créneau${nAbs > 1 ? 'x' : ''} marqué${nAbs > 1 ? 's' : ''}. ` : ''}Les absences sont enregistrées sur cet appareil uniquement : un export permet de les garder en lieu sûr ou de les passer sur un autre appareil.</p>` +
      '<button type="button" class="btn" data-act="export">Exporter mes absences</button><button type="button" class="btn" data-act="import-json">Restaurer une sauvegarde</button></section>' +
      '<section class="set"><h3>Remise à zéro</h3><button type="button" class="btn danger" data-act="clear">Effacer toutes les absences</button></section>');
  }

  /* ───────── import d'un nouvel emploi du temps ───────── */

  function previewImport(next) {
    const sum = list => { const o = {}; list.forEach(s => { o[s.sub] = (o[s.sub] || 0) + s.m; }); return o; };
    const fresh = C.listSessions(next), oldSum = sum(sessions), newSum = sum(fresh);
    const ids = {}; fresh.forEach(s => { ids[s.id] = true; });
    const lost = Object.keys(absences).filter(id => byId[id] && !ids[id]).sort();
    const rows = C.SUBJECTS.map(s => {
      const a = oldSum[s.id] || 0, b = newSum[s.id] || 0;
      return `<tr><td>${esc(s.name)}</td><td>${C.fmtH(a)}</td><td${a !== b ? ' class="chg"' : ''}>${C.fmtH(b)}</td></tr>`;
    }).join('');
    const lastDay = C.addDays(next.weeks[next.weeks.length - 1].monday, 4);
    let html = `<section class="set"><p><b>${esc(next.source || 'Fichier')}</b> : ${next.weeks.length} semaines, du ${esc(C.fmtDay(next.weeks[0].monday))} au ${esc(C.fmtDay(lastDay))}, ${fresh.length} séances suivies.</p>` +
      `<table class="tbl"><thead><tr><th>Matière</th><th>Actuel</th><th>Nouveau</th></tr></thead><tbody>${rows}</tbody></table>`;
    if (next.warnings && next.warnings.length) html += `<p>À vérifier dans le fichier :</p><ul class="warn-list">${next.warnings.slice(0, 8).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    if (lost.length) {
      const names = lost.slice(0, 6).map(id => `${C.fmtDay(byId[id].date)} (${C.SUBJECT_BY_ID[byId[id].sub].short})`).join(', ');
      html += `<p>${lost.length} absence${lost.length > 1 ? 's portent' : ' porte'} sur un créneau qui n’a plus de cours dans ce fichier : ${esc(names)}${lost.length > 6 ? '…' : ''}. ${lost.length > 1 ? 'Elles ne seront' : 'Elle ne sera'} plus comptée${lost.length > 1 ? 's' : ''}.</p>`;
    } else if (Object.keys(absences).length) html += '<p>Toutes les absences déjà saisies restent rattachées à un cours.</p>';
    html += '</section>';
    confirmSheet('Nouvel emploi du temps', html, 'Utiliser ce fichier', () => {
      const keep = { v: next.v, source: next.source, nSlots: next.nSlots, times: next.times, weeks: next.weeks, importedAt: Date.now() };
      if (!save(KEYS.tt, keep)) { toast("Impossible d'enregistrer cet emploi du temps sur l'appareil."); return; }
      custom = keep; tt = keep;
      model(); weekIndex = homeWeekIndex(); followHome = true; render();
      toast('Emploi du temps mis à jour.');
    });
  }
  $('fileXlsx').addEventListener('change', function () {
    const f = this.files && this.files[0]; this.value = '';
    if (!f) return;
    f.arrayBuffer().then(buf => previewImport(C.parseXlsx(new Uint8Array(buf), f.name)))
      .catch(err => message('Import impossible', `${(err && err.message) || 'Fichier illisible.'} L’emploi du temps actuel est conservé.`));
  });

  /* ───────── sauvegarde ───────── */

  function exportBackup() {
    const name = `fiche-presence-${C.localIso(new Date())}.json`;
    const json = JSON.stringify({ app: 'fiche-presence', v: 1, exportedAt: new Date().toISOString(), absences, settings, timetable: custom }, null, 1);
    let file = null;
    try { file = new File([json], name, { type: 'application/json' }); } catch (e) { file = null; }
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (touch && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Sauvegarde des absences' }).catch(() => { /* partage annulé */ });
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file || new Blob([json], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Sauvegarde téléchargée.');
  }
  $('fileJson').addEventListener('change', function () {
    const f = this.files && this.files[0]; this.value = '';
    if (!f) return;
    f.text().then(txt => {
      const data = JSON.parse(txt);
      if (!data || data.app !== 'fiche-presence' || typeof data.absences !== 'object') throw new Error('format');
      const abs = cleanAbsences(data.absences), n = Object.keys(abs).length, cur = Object.keys(absences).length;
      const when = data.exportedAt ? ` du ${C.fmtDay(C.localIso(new Date(data.exportedAt)))}` : '';
      confirmSheet('Restaurer la sauvegarde', `<section class="set"><p>Sauvegarde${esc(when)} : <b>${n} créneau${n > 1 ? 'x' : ''} marqué${n > 1 ? 's' : ''}</b>` +
        (validTimetable(data.timetable) ? ', avec son emploi du temps importé' : '') + `. Elle remplacera les ${cur} actuellement enregistré${cur > 1 ? 's' : ''} sur cet appareil.</p></section>`, 'Restaurer', () => {
        absences = abs; persistAbsences();
        if (data.settings && ['strict', 'planned', 'official'].indexOf(data.settings.base) >= 0) { settings.base = data.settings.base; save(KEYS.set, settings); }
        if (validTimetable(data.timetable)) { custom = data.timetable; tt = custom; save(KEYS.tt, custom); }
        model(); weekIndex = homeWeekIndex(); followHome = true; render();
        toast('Sauvegarde restaurée.');
      });
    }).catch(() => message('Restauration impossible', 'Ce fichier n’est pas une sauvegarde de la fiche de présence.'));
  });

  /* ───────── événements ───────── */

  $('prev').innerHTML = ICON.left; $('next').innerHTML = ICON.right; $('today').innerHTML = ICON.today; $('menu').innerHTML = ICON.menu;
  $('prev').addEventListener('click', () => go(weekIndex - 1));
  $('next').addEventListener('click', () => go(weekIndex + 1));
  $('today').addEventListener('click', () => go(homeWeekIndex()));
  $('weekpick').addEventListener('click', openWeekPicker);
  $('menu').addEventListener('click', openSettings);

  const grid = $('grid');
  grid.addEventListener('click', e => {
    if (Date.now() - swipedAt < 400) return;
    const b = e.target.closest('button.course');
    if (b) cycle(b.dataset.id);
  });
  let touch0 = null;
  grid.addEventListener('touchstart', e => { touch0 = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
  grid.addEventListener('touchend', e => {
    if (!touch0) return;
    const t = e.changedTouches[0], dx = t.clientX - touch0.x, dy = t.clientY - touch0.y;
    touch0 = null;
    if (Math.abs(dx) < 56 || Math.abs(dx) < 1.6 * Math.abs(dy)) return;
    const target = weekIndex + (dx < 0 ? 1 : -1);
    if (target < 0 || target >= tt.weeks.length) return;
    swipedAt = Date.now(); go(target);
  }, { passive: true });

  function pick(e) {
    const el = e.target.closest('[data-sub]'); if (!el) return false;
    selected = selected === el.dataset.sub ? null : el.dataset.sub;
    renderPie();
    const again = $('pieCard').querySelector(`${el.tagName.toLowerCase() === 'path' ? 'path' : 'button'}[data-sub="${el.dataset.sub}"]`);
    if (again && e.type === 'keydown') again.focus();
    return true;
  }
  $('pieCard').addEventListener('click', pick);
  $('pieCard').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('path[data-sub]')) { e.preventDefault(); pick(e); } });

  sheet.addEventListener('click', e => {
    if (e.target === sheet) { closeSheet(); return; }
    const el = e.target.closest('[data-act]'); if (!el) return;
    switch (el.dataset.act) {
      case 'close': closeSheet(); break;
      case 'yes': { const fn = pending; closeSheet(); if (fn) fn(); break; }
      case 'week': closeSheet(); go(+el.dataset.week); break;
      case 'base': {
        const top = sheet.querySelector('.sheet-body').scrollTop;
        settings.base = el.dataset.base; save(KEYS.set, settings); model(); render(); openSettings();
        sheet.querySelector('.sheet-body').scrollTop = top;
        break;
      }
      case 'import-xlsx': closeSheet(); $('fileXlsx').click(); break;
      case 'import-json': closeSheet(); $('fileJson').click(); break;
      case 'export': closeSheet(); exportBackup(); break;
      case 'reset-tt':
        confirmSheet('Revenir à la version intégrée', `<section class="set"><p>L’emploi du temps importé sera remplacé par <b>${esc(DEFAULT_TT.source || 'la version intégrée')}</b>. Les absences sont conservées.</p></section>`, 'Revenir', () => {
          drop(KEYS.tt); custom = null; tt = DEFAULT_TT;
          model(); weekIndex = homeWeekIndex(); followHome = true; render();
          toast('Emploi du temps intégré rétabli.');
        });
        break;
      case 'clear': {
        const n = Object.keys(absences).length;
        if (!n) { closeSheet(); toast('Aucune absence enregistrée.'); break; }
        confirmSheet('Effacer toutes les absences', `<section class="set"><p>Les <b>${n} créneau${n > 1 ? 'x' : ''} marqué${n > 1 ? 's' : ''}</b> (absences et justifications) seront effacé${n > 1 ? 's' : ''} de cet appareil. Sans sauvegarde exportée, c’est définitif.</p></section>`, 'Tout effacer', () => {
          absences = {}; persistAbsences(); model(); render(); toast('Absences effacées.');
        }, true);
        break;
      }
      default: break;
    }
  });
  sheet.addEventListener('close', () => { pending = null; });

  document.addEventListener('keydown', e => {
    if (sheet.open || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft') go(weekIndex - 1); else if (e.key === 'ArrowRight') go(weekIndex + 1);
  });

  // Au retour dans l'app (ou quand l'heure avance) : « prévu » devient « absent », la semaine suit le calendrier.
  function refresh() {
    if (sheet.open) return;
    model();
    if (followHome) weekIndex = homeWeekIndex();
    render();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 5 * 60 * 1000);

  /* ───────── démarrage ───────── */

  model();
  weekIndex = homeWeekIndex();
  render();

  // Outils de test en local uniquement (import d'un fichier sans passer par le sélecteur).
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (local) window.__fp = { previewImport, state: () => ({ tt, absences, settings, stats, weekIndex }) };
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && (!local || /[?&]sw=1/.test(location.search))) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* hors-ligne indisponible, l'app marche quand même */ });
  }
})();
