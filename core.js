/* Fiche de présence — cœur partagé entre le navigateur (window.Core) et Node (require).
 *
 *  1. lecture d'un emploi du temps .xlsx sans dépendance (dézippage + XML)
 *     mise en page attendue : une ligne « Lundi … Vendredi », une ligne d'horaires,
 *     puis un bloc de lignes par semaine avec la date du lundi en première colonne
 *  2. liste des séances suivies et calcul des heures manquées / de la marge des 20 %
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const THRESHOLD = 0.2;   // 20 % d'absence maximum par matière
  const SLOT_MIN = 120;    // un créneau compte 2 h dans les volumes officiels
  const DEFAULT_TIMES = [[510, 620], [640, 750], [840, 950], [970, 1080]];

  // Ordre fixe : il détermine aussi la couleur de chaque matière.
  // `official` = volume horaire du PDF « Contenu de la formation ».
  // `short` = nom dans les cases de la semaine, `mid` = nom dans la légende du camembert.
  const SUBJECTS = [
    { id: 'GIPEX', name: 'GIPEX', mid: 'GIPEX', short: 'GIPEX', official: 60, re: /^GIPEX/i },
    { id: 'SGSE', name: 'SGSE', mid: 'SGSE', short: 'SGSE', official: 60, re: /^SGSE/i },
    { id: 'DATA', name: 'Data Science', mid: 'Data', short: 'Data', official: 50, re: /^Data\b/i },
    { id: 'ROBOT', name: 'Robotique', mid: 'Robotique', short: 'Robot.', official: 50, re: /^Robotique/i },
    { id: 'PROJET', name: 'Projet complexe', mid: 'Projet', short: 'Projet', official: 50, re: /^Projet\b/i },
    { id: 'LV2', name: 'LV2 Arabe', mid: 'LV2 Arabe', short: 'LV2', official: 20, re: /^LV(2|S9)\b/i },
    { id: 'AN9', name: 'Anglais', mid: 'Anglais', short: 'Anglais', official: 20, re: /^AN9\b/i },
    { id: 'APE9', name: 'APE9', mid: 'APE9', short: 'APE9', official: 14, re: /^APE?9\b/i },
  ];
  const SUBJECT_BY_ID = {};
  SUBJECTS.forEach((s, i) => { s.index = i; SUBJECT_BY_ID[s.id] = s; });

  // Groupes de LV2 qui ne me concernent pas (MA = espagnol). Tout autre « LV2 » est suivi.
  const LV2_OTHER_GROUP = /\(\s*MA\s*\)|espagnol/i;
  const OFF_RE = /^(vacances|f[ée]ri[ée])/i;

  /* ───────────────────────── dates ───────────────────────── */

  const pad = n => String(n).padStart(2, '0');
  const isoFromUTC = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const utcFromIso = iso => { const p = iso.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); };
  const addDays = (iso, n) => { const d = utcFromIso(iso); d.setUTCDate(d.getUTCDate() + n); return isoFromUTC(d); };
  const serialToIso = n => isoFromUTC(new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000));
  const localIso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const nowInfo = d => { d = d || new Date(); return { date: localIso(d), minutes: d.getHours() * 60 + d.getMinutes() }; };

  /* ─────────────────── inflate (RFC 1951) ─────────────────── */

  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function huffman(lengths, n) {
    const count = new Uint16Array(16), symbol = new Uint16Array(n), offs = new Uint16Array(16);
    for (let i = 0; i < n; i++) count[lengths[i]]++;
    for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
    for (let i = 0; i < n; i++) if (lengths[i] !== 0) symbol[offs[lengths[i]]++] = i;
    return { count, symbol };
  }
  let FIXED = null;
  function fixedTables() {
    if (FIXED) return FIXED;
    const l = new Uint8Array(288);
    for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
    FIXED = { len: huffman(l, 288), dist: huffman(new Uint8Array(30).fill(5), 30) };
    return FIXED;
  }

  function inflateRaw(src, sizeHint) {
    let out = new Uint8Array(sizeHint > 0 ? sizeHint : Math.max(1024, src.length * 4));
    let op = 0, ip = 0, bitBuf = 0, bitCnt = 0;
    const bad = () => { throw new Error('Données compressées illisibles'); };
    const need = n => {
      if (op + n <= out.length) return;
      const b = new Uint8Array(Math.max(out.length * 2, op + n)); b.set(out); out = b;
    };
    const bits = n => {
      let v = bitBuf;
      while (bitCnt < n) { if (ip >= src.length) bad(); v |= src[ip++] << bitCnt; bitCnt += 8; }
      bitBuf = v >>> n; bitCnt -= n;
      return v & ((1 << n) - 1);
    };
    const decode = h => {
      let code = 0, first = 0, index = 0;
      for (let len = 1; len <= 15; len++) {
        code |= bits(1);
        const count = h.count[len];
        if (code - count < first) return h.symbol[index + (code - first)];
        index += count; first += count; first <<= 1; code <<= 1;
      }
      return bad();
    };
    const codes = (lc, dc) => {
      for (;;) {
        let sym = decode(lc);
        if (sym < 256) { need(1); out[op++] = sym; continue; }
        if (sym === 256) return;
        sym -= 257; if (sym >= 29) bad();
        const len = LBASE[sym] + bits(LEXT[sym]);
        const ds = decode(dc); if (ds >= 30) bad();
        const dist = DBASE[ds] + bits(DEXT[ds]);
        if (dist > op) bad();
        need(len);
        for (let i = 0; i < len; i++, op++) out[op] = out[op - dist];
      }
    };
    const stored = () => {
      bitBuf = 0; bitCnt = 0;
      if (ip + 4 > src.length) bad();
      const len = src[ip] | (src[ip + 1] << 8), nlen = src[ip + 2] | (src[ip + 3] << 8);
      ip += 4;
      if ((len ^ 0xffff) !== nlen || ip + len > src.length) bad();
      need(len); out.set(src.subarray(ip, ip + len), op); op += len; ip += len;
    };
    const dynamic = () => {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      if (nlen > 286 || ndist > 30) bad();
      const cl = new Uint8Array(19);
      for (let i = 0; i < ncode; i++) cl[CL_ORDER[i]] = bits(3);
      const clc = huffman(cl, 19), l = new Uint8Array(nlen + ndist);
      let i = 0;
      while (i < nlen + ndist) {
        const sym = decode(clc);
        if (sym < 16) { l[i++] = sym; continue; }
        let val = 0, rep;
        if (sym === 16) { if (i === 0) bad(); val = l[i - 1]; rep = 3 + bits(2); }
        else if (sym === 17) rep = 3 + bits(3);
        else rep = 11 + bits(7);
        if (i + rep > nlen + ndist) bad();
        while (rep--) l[i++] = val;
      }
      if (l[256] === 0) bad();
      codes(huffman(l.subarray(0, nlen), nlen), huffman(l.subarray(nlen), ndist));
    };
    let last;
    do {
      last = bits(1);
      const type = bits(2);
      if (type === 0) stored();
      else if (type === 1) { const f = fixedTables(); codes(f.len, f.dist); }
      else if (type === 2) dynamic();
      else bad();
    } while (!last);
    return out.subarray(0, op);
  }

  /* ───────────────────────── zip ───────────────────────── */

  function unzip(input) {
    const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let eocd = -1;
    for (let i = buf.length - 22, stop = Math.max(0, buf.length - 22 - 65535); i >= stop; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Ce fichier n'est pas un classeur Excel (.xlsx).");
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const td = new TextDecoder('utf-8'), files = {};
    for (let i = 0; i < count; i++) {
      if (off + 46 > buf.length || dv.getUint32(off, true) !== 0x02014b50) throw new Error('Archive .xlsx endommagée.');
      const nlen = dv.getUint16(off + 28, true), elen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
      const name = td.decode(buf.subarray(off + 46, off + 46 + nlen)).replace(/\\/g, '/').replace(/^\//, '');
      files[name.toLowerCase()] = { method: dv.getUint16(off + 10, true), csize: dv.getUint32(off + 20, true), usize: dv.getUint32(off + 24, true), lho: dv.getUint32(off + 42, true) };
      off += 46 + nlen + elen + clen;
    }
    const read = name => {
      const f = files[String(name).replace(/^\//, '').toLowerCase()];
      if (!f) return null;
      if (dv.getUint32(f.lho, true) !== 0x04034b50) throw new Error('Archive .xlsx endommagée.');
      const start = f.lho + 30 + dv.getUint16(f.lho + 26, true) + dv.getUint16(f.lho + 28, true);
      const data = buf.subarray(start, start + f.csize);
      if (f.method === 0) return data;
      if (f.method === 8) return inflateRaw(data, f.usize);
      throw new Error('Compression non prise en charge dans ce fichier.');
    };
    return { names: Object.keys(files), read, text: name => { const d = read(name); return d ? td.decode(d) : null; } };
  }

  /* ───────────────────────── XML du classeur ───────────────────────── */

  const decodeXml = s => s
    .replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, e) => {
      if (e === 'amp') return '&'; if (e === 'lt') return '<'; if (e === 'gt') return '>';
      if (e === 'quot') return '"'; if (e === 'apos') return "'";
      const code = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)));

  const attr = (s, name) => {
    const m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*"([^"]*)"').exec(s || '');
    return m ? decodeXml(m[1]) : undefined;
  };
  const richText = body => {
    let s = ''; const re = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g; let t;
    body = body.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    while ((t = re.exec(body))) s += decodeXml(t[1] || '');
    return s;
  };
  function parseSharedStrings(xml) {
    const out = []; if (!xml) return out;
    const re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g; let m;
    while ((m = re.exec(xml))) out.push(richText(m[1] || ''));
    return out;
  }
  function parseStyles(xml) {
    const fills = [], xfFill = [];
    if (!xml) return { fills, xfFill };
    const fm = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(xml);
    if (fm) {
      const re = /<fill\b[^>]*?(?:\/>|>([\s\S]*?)<\/fill>)/g; let m;
      while ((m = re.exec(fm[1]))) {
        const body = m[1] || '';
        const type = attr((/<patternFill\b([^>]*)/.exec(body) || [])[1], 'patternType');
        const fg = (/<fgColor\b([^>]*)/.exec(body) || [])[1];
        fills.push(type && type !== 'none' && fg !== undefined
          ? { rgb: attr(fg, 'rgb'), theme: attr(fg, 'theme'), tint: +(attr(fg, 'tint') || 0) } : null);
      }
    }
    const xm = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
    if (xm) {
      const re = /<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g; let m;
      while ((m = re.exec(xm[1]))) xfFill.push(+(attr(m[1], 'fillId') || 0));
    }
    return { fills, xfFill };
  }
  // Gris « pas de cours » (blanc assombri du thème, ou gris RVB) : sert pour les cases vides grisées.
  function isGreyFill(f) {
    if (!f) return false;
    if (f.theme === '0' && f.tint < -0.15) return true;
    if (f.rgb && /^[0-9a-fA-F]{8}$/.test(f.rgb)) {
      const r = parseInt(f.rgb.slice(2, 4), 16), g = parseInt(f.rgb.slice(4, 6), 16), b = parseInt(f.rgb.slice(6, 8), 16);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      return max - min < 16 && max > 0x60 && max < 0xe8;
    }
    return false;
  }
  const KEY = (c, r) => r * 16384 + c;
  function parseRef(ref) {
    const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref || ''); if (!m) return null;
    let c = 0; for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
    return { c, r: +m[2] };
  }
  function parseSheet(xml, strings) {
    const cells = new Map(), merges = [];
    let maxRow = 0;
    const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let m;
    while ((m = re.exec(xml))) {
      const p = parseRef(attr(m[1], 'r')); if (!p) continue;
      const t = attr(m[1], 't'), s = attr(m[1], 's'), inner = m[2] || '';
      let v;
      if (t === 'inlineStr') v = richText((/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner) || [])[1] || '');
      else {
        const vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        if (vm) {
          const raw = decodeXml(vm[1]);
          if (t === 's') v = strings[+raw];
          else if (t === 'str' || t === 'e' || t === 'b') v = raw;
          else { const n = Number(raw); v = Number.isFinite(n) && raw.trim() !== '' ? n : raw; }
        }
      }
      cells.set(KEY(p.c, p.r), { v, s: s === undefined ? -1 : +s });
      if (p.r > maxRow) maxRow = p.r;
    }
    const mre = /<mergeCell\b[^>]*?ref="([^"]+)"/g;
    while ((m = mre.exec(xml))) {
      const parts = m[1].split(':'), a = parseRef(parts[0]), b = parseRef(parts[1] || parts[0]);
      if (a && b) merges.push({ c1: Math.min(a.c, b.c), r1: Math.min(a.r, b.r), c2: Math.max(a.c, b.c), r2: Math.max(a.r, b.r) });
    }
    return { cells, merges, maxRow };
  }

  /* ───────────────────────── emploi du temps ───────────────────────── */

  const DAY_RE = [/^lundi$/i, /^mardi$/i, /^mercredi$/i, /^jeudi$/i, /^vendredi$/i, /^samedi$/i];
  const DAY_SHORT = ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];
  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const cleanText = v => v === undefined || v === null ? '' :
    String(v).replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
  const fmtDay = iso => { const p = iso.split('-').map(Number); return `${p[2] === 1 ? '1er' : p[2]} ${MONTHS[p[1] - 1]}`; };

  function classify(text) {
    if (!text) return { k: 'o' };
    if (OFF_RE.test(text)) return { k: 'o' };
    for (const s of SUBJECTS) {
      if (!s.re.test(text)) continue;
      if (s.id === 'LV2' && LV2_OTHER_GROUP.test(text)) return { k: 'skip' };
      return { k: 'c', sub: s.id };
    }
    return { k: 'x' };
  }
  // « LV2 (ZT) 3h », « … 1h30 » : durée écrite en toutes lettres à la fin du libellé.
  function explicitMinutes(text) {
    const m = /(\d{1,2})\s*h\s*(\d{2})?\s*$/i.exec(text);
    if (!m) return 0;
    const min = +m[1] * 60 + (m[2] ? +m[2] : 0);
    return min > 0 && min <= 600 ? min : 0;
  }
  function parseTimeRange(text) {
    const m = /(\d{1,2})\s*h\s*(\d{2})?\s*[-–]\s*(\d{1,2})\s*h\s*(\d{2})?/i.exec(text || '');
    return m ? [+m[1] * 60 + +(m[2] || 0), +m[3] * 60 + +(m[4] || 0)] : null;
  }

  function buildTimetable(sheet, styles, source) {
    const { cells, merges, maxRow } = sheet;
    const cell = (c, r) => cells.get(KEY(c, r));
    const textAt = (c, r) => { const x = cell(c, r); return x ? cleanText(x.v) : ''; };
    const mergeMap = new Map();
    merges.forEach(mg => { for (let r = mg.r1; r <= mg.r2; r++) for (let c = mg.c1; c <= mg.c2; c++) mergeMap.set(KEY(c, r), mg); });
    const warnings = [];

    // 1. ligne des jours
    let headerRow = 0;
    for (const [key, x] of cells) {
      if (typeof x.v === 'string' && DAY_RE[0].test(x.v.trim())) { const r = Math.floor(key / 16384); if (!headerRow || r < headerRow) headerRow = r; }
    }
    if (!headerRow) throw new Error("Je ne trouve pas la ligne « Lundi, Mardi… » dans la première feuille. Est-ce bien l'emploi du temps ?");
    const days = [];
    let weekCol = 0;
    for (let c = 1; c <= 80; c++) {
      const t = textAt(c, headerRow); if (!t) continue;
      if (/^semaine/i.test(t)) weekCol = c;
      const d = DAY_RE.findIndex(re => re.test(t));
      if (d >= 0 && !days.some(x => x.d === d)) days.push({ d, c1: c, c2: c });
    }
    days.sort((a, b) => a.c1 - b.c1);
    days.forEach((day, i) => {
      const mg = mergeMap.get(KEY(day.c1, headerRow));
      const next = days[i + 1];
      day.c2 = mg ? mg.c2 : next ? next.c1 - 1 : day.c1 + (i ? days[0].c2 - days[0].c1 : 3);
    });
    const nSlots = days[0].c2 - days[0].c1 + 1;
    if (nSlots < 1 || nSlots > 8) throw new Error('Mise en page inattendue : nombre de créneaux par jour illisible.');
    if (!weekCol) weekCol = Math.max(1, days[0].c1 - 1);

    // 2. horaires (ligne sous les jours)
    const nDays = Math.max.apply(null, days.map(x => x.d)) + 1;
    const times = [];
    for (let d = 0; d < nDays; d++) times.push(DEFAULT_TIMES.slice(0, nSlots).map(t => t.slice()));
    days.forEach(day => {
      for (let s = 0; s < nSlots; s++) { const tr = parseTimeRange(textAt(day.c1 + s, headerRow + 1)); if (tr) times[day.d][s] = tr; }
    });

    // 3. semaines : une date (numéro de série Excel) dans la colonne « Semaine »
    const starts = [];
    for (let r = headerRow + 1; r <= maxRow; r++) {
      const x = cell(weekCol, r);
      if (x && typeof x.v === 'number' && x.v > 20000 && x.v < 80000) starts.push({ r, serial: x.v });
    }
    if (!starts.length) throw new Error('Je ne trouve aucune semaine datée dans la colonne « Semaine ».');
    const gaps = starts.slice(1).map((s, i) => s.r - starts[i].r).filter(g => g > 0 && g <= 6);
    const typical = gaps.length ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 2;
    let prevIso = null;
    const weeks = starts.map((st, i) => {
      const next = starts[i + 1];
      const ra = st.r, rb = Math.min(next ? next.r - 1 : st.r + typical - 1, st.r + 5);
      // Les lignes de janvier sont souvent saisies sans l'année : on les recale après la semaine précédente.
      let iso = serialToIso(st.serial);
      for (let k = 0; prevIso && iso <= prevIso && k < 5; k++) iso = `${+iso.slice(0, 4) + 1}${iso.slice(4)}`;
      if (utcFromIso(iso).getUTCDay() !== 1) warnings.push(`La semaine du ${fmtDay(iso)} ne commence pas un lundi dans le fichier.`);
      prevIso = iso;

      const parts = days.map(() => []);
      const seen = new Set();
      for (let r = ra; r <= rb; r++) {
        for (let di = 0; di < days.length; di++) {
          const day = days[di];
          for (let c = day.c1; c <= day.c2; c++) {
            const mg = mergeMap.get(KEY(c, r));
            const id = mg ? KEY(mg.c1, mg.r1) : KEY(c, r);
            if (seen.has(id)) continue; seen.add(id);
            const top = mg ? cell(mg.c1, mg.r1) : cell(c, r);
            const text = top ? cleanText(top.v) : '';
            const grey = !text && top && top.s >= 0 && isGreyFill(styles.fills[styles.xfFill[top.s]]);
            if (!text && !grey) continue;
            const c1 = mg ? mg.c1 : c, c2 = mg ? mg.c2 : c, r1 = mg ? mg.r1 : r, r2 = mg ? mg.r2 : r;
            days.forEach((dd, dj) => {
              const a = Math.max(c1, dd.c1), b = Math.min(c2, dd.c2);
              if (a <= b) parts[dj].push({ s: a - dd.c1, n: b - a + 1, text, full: r1 <= ra && r2 >= rb, row: r1 - ra });
            });
          }
        }
      }

      const out = []; for (let d = 0; d < nDays; d++) out.push([]);
      days.forEach((day, di) => {
        const label = `${DAY_SHORT[day.d]} ${fmtDay(addDays(iso, day.d))}`;
        const cands = [];
        parts[di].forEach(p => {
          const cl = classify(p.text);
          if (cl.k === 'skip') return;
          if (cl.k === 'c') {
            const em = explicitMinutes(p.text);
            if (em) cands.push({ k: 'c', s: p.s, n: p.n, t: p.text, sub: cl.sub, m: em, row: p.row, full: p.full });
            else for (let j = 0; j < p.n; j++) cands.push({ k: 'c', s: p.s + j, n: 1, t: p.text, sub: cl.sub, m: SLOT_MIN, row: p.row, full: p.full });
          } else cands.push({ k: cl.k, s: p.s, n: p.n, t: p.text, row: p.row, full: p.full });
        });
        const prio = { c: 0, x: 1, o: 2 };
        cands.sort((a, b) => prio[a.k] - prio[b.k] || (b.full - a.full) || a.row - b.row || a.s - b.s);
        const occ = new Array(nSlots).fill(null), blocks = [];
        cands.forEach(cd => {
          const slots = []; for (let s = cd.s; s < cd.s + cd.n && s < nSlots; s++) slots.push(s);
          const free = slots.filter(s => !occ[s]);
          if (cd.k === 'c') {
            if (free.length !== slots.length) {
              const other = occ[slots.find(s => occ[s])];
              if (other.k === 'c' && other.t !== cd.t) warnings.push(`${label} : « ${other.t} » et « ${cd.t} » tombent sur le même créneau, seul le premier est gardé.`);
              return;
            }
            slots.forEach(s => { occ[s] = cd; });
            blocks.push({ s: cd.s, n: slots.length, t: cd.t, k: 'c', sub: cd.sub, m: cd.m });
          } else {
            let run = [];
            const flush = () => { if (run.length) { blocks.push({ s: run[0], n: run.length, t: cd.t, k: cd.k }); run = []; } };
            slots.forEach(s => { if (!occ[s]) { occ[s] = cd; run.push(s); } else flush(); });
            flush();
          }
        });
        blocks.sort((a, b) => a.s - b.s);
        // cases « sans cours » voisines et identiques : un seul bloc
        out[day.d] = blocks.reduce((acc, b) => {
          const p = acc[acc.length - 1];
          if (p && p.k === 'o' && b.k === 'o' && p.t === b.t && p.s + p.n === b.s) p.n += b.n; else acc.push(b);
          return acc;
        }, []);
      });
      return { monday: iso, days: out };
    });

    for (let i = 1; i < weeks.length; i++) {
      if (weeks[i].monday !== addDays(weeks[i - 1].monday, 7)) warnings.push(`Après la semaine du ${fmtDay(weeks[i - 1].monday)}, le fichier passe directement au ${fmtDay(weeks[i].monday)}.`);
    }
    return { v: 1, source: source || '', nSlots, times, weeks, warnings };
  }

  function parseXlsx(input, source) {
    const zip = unzip(input);
    let sheetPath = 'xl/worksheets/sheet1.xml';
    const wb = zip.text('xl/workbook.xml'), rels = zip.text('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const sm = /<sheet\b([^>]*)\/?>/.exec(wb);
      const rid = sm && (attr(sm[1], 'r:id') || attr(sm[1], 'id'));
      if (rid) {
        const re = /<Relationship\b([^>]*)\/?>/g; let m;
        while ((m = re.exec(rels))) {
          if (attr(m[1], 'Id') !== rid) continue;
          const target = attr(m[1], 'Target') || '';
          sheetPath = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
        }
      }
    }
    const sheetXml = zip.text(sheetPath) || zip.text('xl/worksheets/sheet1.xml');
    if (!sheetXml) throw new Error('Ce classeur ne contient pas de feuille lisible.');
    const strings = parseSharedStrings(zip.text('xl/sharedStrings.xml'));
    const tt = buildTimetable(parseSheet(sheetXml, strings), parseStyles(zip.text('xl/styles.xml')), source);
    if (!listSessions(tt).length) throw new Error("Aucun cours reconnu dans ce fichier (GIPEX, SGSE, Data, Robotique, Projet, LV2, AN9, AP9).");
    return tt;
  }

  /* ───────────────────────── séances et statistiques ───────────────────────── */

  function listSessions(tt) {
    const out = [];
    tt.weeks.forEach((w, wi) => w.days.forEach((blocks, d) => blocks.forEach(b => {
      if (b.k !== 'c' || !SUBJECT_BY_ID[b.sub]) return;
      const date = addDays(w.monday, d);
      const t = ((tt.times && tt.times[d]) || DEFAULT_TIMES)[b.s] || DEFAULT_TIMES[b.s] || [0, 0];
      out.push({ id: `${date}#${b.s}`, wi, d, date, s: b.s, n: b.n, sub: b.sub, t: b.t, m: b.m, start: t[0] });
    })));
    return out;
  }
  const isPast = (se, now) => se.date < now.date || (se.date === now.date && se.start <= now.minutes);

  /* absences : { "2026-11-17#1": "A" (absent, compte dans les 20 %) | "J" (justifiée, ne compte pas) }
   * base     : 'strict' (le plus petit des deux volumes) | 'planned' (heures de l'Excel) | 'official' (PDF) */
  function computeStats(tt, absences, base, now) {
    const EPS = 1e-6, acc = {};
    SUBJECTS.forEach(s => { acc[s.id] = { planned: 0, absPast: 0, absFuture: 0, justified: 0, open: [], nUpcoming: 0 }; });
    listSessions(tt).forEach(se => {
      const a = acc[se.sub], past = isPast(se, now), st = absences[se.id];
      a.planned += se.m;
      if (!past) a.nUpcoming++;
      if (st === 'A') { if (past) a.absPast += se.m; else a.absFuture += se.m; }
      else if (st === 'J') a.justified += se.m;
      else if (!past) a.open.push(se);
    });
    const locked = {};
    const tot = { planned: 0, ref: 0, counted: 0, absPast: 0, absFuture: 0, justified: 0 };
    const subjects = SUBJECTS.map(s => {
      const a = acc[s.id], official = s.official * 60;
      const ref = base === 'planned' ? a.planned : base === 'official' ? official : Math.min(a.planned, official);
      const limit = ref * THRESHOLD;
      const counted = a.absPast + a.absFuture;
      const remaining = limit - counted;
      let canMiss = 0, cum = 0;
      a.open.map(x => x.m).sort((x, y) => x - y).forEach(m => { if (cum + m <= remaining + EPS) { cum += m; canMiss++; } });
      a.open.forEach(se => { if (counted + se.m > limit + EPS) locked[se.id] = true; });
      let status;
      if (a.planned === 0) status = 'none';
      else if (counted > limit + EPS) status = 'over';
      else if (a.nUpcoming === 0) status = 'done';
      else if (!a.open.length) status = remaining + EPS >= SLOT_MIN ? 'ok' : 'locked';
      else status = canMiss === 0 ? 'locked' : canMiss === 1 ? 'last' : 'ok';
      tot.planned += a.planned; tot.ref += ref; tot.counted += counted;
      tot.absPast += a.absPast; tot.absFuture += a.absFuture; tot.justified += a.justified;
      return { id: s.id, planned: a.planned, official, ref, limit, counted, absPast: a.absPast, absFuture: a.absFuture,
        justified: a.justified, remaining, canMiss, nUpcoming: a.nUpcoming, status, pct: ref ? counted / ref : 0 };
    });
    tot.pct = tot.ref ? tot.counted / tot.ref : 0;
    return { subjects, total: tot, locked };
  }

  /* ───────────────────────── formats ───────────────────────── */

  function fmtH(min) {
    const neg = min < -1e-6; min = Math.abs(min);
    let s;
    if (Math.abs(min / 30 - Math.round(min / 30)) < 1e-6) {
      min = Math.round(min);
      const h = Math.floor(min / 60), r = min - h * 60;
      s = r ? (h ? `${h} h ${pad(r)}` : `${r} min`) : `${h} h`;
    } else s = String(Math.round(min / 6) / 10).replace('.', ',') + ' h';
    return (neg ? '−' : '') + s;
  }
  function fmtPct(x) {
    const v = Math.round(x * 1000) / 10;
    return String(v).replace('.', ',') + ' %';
  }
  const fmtTime = min => `${Math.floor(min / 60)}h${pad(min % 60)}`;

  return {
    THRESHOLD, SLOT_MIN, SUBJECTS, SUBJECT_BY_ID, DEFAULT_TIMES, MONTHS,
    inflateRaw, unzip, parseXlsx, classify, explicitMinutes,
    listSessions, computeStats, isPast,
    addDays, localIso, nowInfo, utcFromIso, fmtH, fmtPct, fmtTime, fmtDay,
  };
});
