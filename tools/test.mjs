// Tests du cœur (dézippage, lecture de l'Excel, calcul des 20 %).
//   node tools/test.mjs ["chemin/vers/emploi-du-temps.xlsx"]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { publicLabel, publicTimetable } from './public-labels.mjs';

const require = createRequire(import.meta.url);
const Core = require('../core.js');
const here = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

/* ── inflate : aller-retour contre zlib, tous types de blocs ── */
const samples = [];
samples.push(Buffer.from(''));
samples.push(Buffer.from('a'));
samples.push(Buffer.from('<row r="4"><c r="A4" s="119"><v>46286</v></c></row>'.repeat(400)));
{ let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const b = Buffer.alloc(70000); for (let i = 0; i < b.length; i++) b[i] = rnd() * 256; samples.push(b);            // incompressible
  const t = Buffer.alloc(120000); for (let i = 0; i < t.length; i++) t[i] = 97 + Math.floor(rnd() * rnd() * 26); samples.push(t); // texte biaisé
  const z = Buffer.alloc(300000); samples.push(z); }                                                             // longues répétitions
test('inflate : blocs stockés, Huffman fixe et dynamique', () => {
  const variants = [{ level: 0 }, { level: 1 }, { level: 6 }, { level: 9 }, { strategy: zlib.constants.Z_FIXED },
    { strategy: zlib.constants.Z_HUFFMAN_ONLY }, { strategy: zlib.constants.Z_RLE }, { level: 9, memLevel: 1 }];
  for (const s of samples) for (const o of variants) {
    const packed = zlib.deflateRawSync(s, o);
    for (const hint of [s.length, 0]) {
      const got = Core.inflateRaw(new Uint8Array(packed), hint);
      assert.equal(Buffer.compare(Buffer.from(got), s), 0, `taille ${s.length}, options ${JSON.stringify(o)}`);
    }
  }
});
test('inflate : données tronquées → erreur, pas de boucle', () => {
  const packed = zlib.deflateRawSync(samples[2]);
  assert.throws(() => Core.inflateRaw(new Uint8Array(packed.subarray(0, packed.length - 7)), 0));
});
test('unzip : fichier quelconque refusé proprement', () => {
  assert.throws(() => Core.unzip(new Uint8Array(Buffer.from('ceci nest pas un zip, vraiment pas du tout'))), /Excel/);
});

/* ── formats ── */
test('formats français', () => {
  assert.equal(Core.fmtH(120), '2 h');
  assert.equal(Core.fmtH(90), '1 h 30');
  assert.equal(Core.fmtH(30), '30 min');
  assert.equal(Core.fmtH(0), '0 h');
  assert.equal(Core.fmtH(672), '11,2 h');
  assert.equal(Core.fmtH(168), '2,8 h');
  assert.equal(Core.fmtH(-120), '−2 h');
  assert.equal(Core.fmtPct(0.0375), '3,8 %');
  assert.equal(Core.fmtPct(0.2), '20 %');
  assert.equal(Core.fmtTime(510), '8h30');
});
test('classement des libellés', () => {
  const k = t => { const c = Core.classify(t); return c.k + (c.sub ? ':' + c.sub : ''); };
  assert.equal(k('Data (WZ) info'), 'c:DATA');
  assert.equal(k('Data AH info'), 'c:DATA');
  assert.equal(k('GIPEX(supply chain)'), 'c:GIPEX');
  assert.equal(k('SGSE-AAV1 (PK)'), 'c:SGSE');
  assert.equal(k('AP9 (BK)'), 'c:APE9');
  assert.equal(k('AN9 (Sana)'), 'c:AN9');
  assert.equal(k('Projet (ST+CJM) Robot'), 'c:PROJET');
  assert.equal(k('Robotique (RB+CJM) TP Robot'), 'c:ROBOT');
  assert.equal(k('LV2 (ZT) 3h'), 'c:LV2');
  assert.equal(k('LV2 (MA) 3h'), 'skip');
  assert.equal(k('PJT9'), 'x');
  assert.equal(k('PJT9 - point avancement'), 'x');
  assert.equal(k('Soutenance PJT9'), 'x');
  assert.equal(k('Hackathon (CJM, RB) Robot'), 'x');
  assert.equal(k('Défi IA (PM)'), 'x');
  assert.equal(k('Conf TE.'), 'x');
  assert.equal(k('VACANCES'), 'o');
  assert.equal(k('FERIE'), 'o');
  assert.equal(Core.explicitMinutes('LV2 (ZT) 3h'), 180);
  assert.equal(Core.explicitMinutes('LV2 (ZT) 1h30'), 90);
  assert.equal(Core.explicitMinutes('Data (WZ) info'), 0);
});

/* ── calcul des 20 % sur un mini emploi du temps ── */
const mini = (nData, lv2) => ({
  v: 1, nSlots: 4, times: [0, 1, 2, 3, 4].map(() => Core.DEFAULT_TIMES),
  weeks: Array.from({ length: 10 }, (_, w) => ({
    monday: Core.addDays('2026-09-21', 7 * w),
    days: [0, 1, 2, 3, 4].map(d => {
      const out = [];
      if (d === 0 && w < nData) out.push({ s: 0, n: 1, t: 'Data (WZ) info', k: 'c', sub: 'DATA', m: 120 });
      if (d === 3 && lv2[w]) out.push({ s: 0, n: lv2[w] > 90 ? 2 : 1, t: 'LV2 (ZT)', k: 'c', sub: 'LV2', m: lv2[w] });
      if (d === 4) out.push({ s: 2, n: 2, t: 'PJT9', k: 'x' });
      return out;
    }),
  })),
});
const sub = (st, id) => st.subjects.find(s => s.id === id);
test('20 % : base stricte, seuil, statuts', () => {
  const tt = mini(10, {});                                // Data : 10 séances = 20 h planifiées
  const now = { date: '2026-09-01', minutes: 0 };          // tout est à venir
  const id = w => `${Core.addDays('2026-09-21', 7 * w)}#0`;
  let st = Core.computeStats(tt, {}, 'strict', now);
  assert.equal(sub(st, 'DATA').planned, 1200);
  assert.equal(sub(st, 'DATA').ref, 1200);                 // min(20 h planifiées, 50 h officielles)
  assert.equal(sub(st, 'DATA').limit, 240);                // 20 % de 20 h = 4 h = 2 séances
  assert.equal(sub(st, 'DATA').canMiss, 2);
  assert.equal(sub(st, 'DATA').status, 'ok');
  assert.equal(Object.keys(st.locked).length, 0);
  assert.equal(Core.computeStats(tt, {}, 'official', now).subjects[2].limit, 600);  // 20 % de 50 h

  st = Core.computeStats(tt, { [id(0)]: 'A' }, 'strict', now);
  assert.equal(sub(st, 'DATA').status, 'last');
  assert.equal(sub(st, 'DATA').remaining, 120);

  st = Core.computeStats(tt, { [id(0)]: 'A', [id(1)]: 'A' }, 'strict', now);
  assert.equal(sub(st, 'DATA').status, 'locked');          // pile 20 % : autorisé mais plus de marge
  assert.equal(sub(st, 'DATA').pct, 0.2);
  assert.equal(Object.keys(st.locked).length, 8);          // les 8 séances restantes sont verrouillées
  assert.ok(st.locked[id(5)] && !st.locked[id(0)]);

  st = Core.computeStats(tt, { [id(0)]: 'A', [id(1)]: 'A', [id(2)]: 'A' }, 'strict', now);
  assert.equal(sub(st, 'DATA').status, 'over');
  assert.equal(sub(st, 'DATA').remaining, -120);

  st = Core.computeStats(tt, { [id(0)]: 'A', [id(1)]: 'J', [id(2)]: 'J' }, 'strict', now);
  assert.equal(sub(st, 'DATA').counted, 120);              // les justifiées ne comptent pas
  assert.equal(sub(st, 'DATA').justified, 240);
  assert.equal(sub(st, 'DATA').status, 'last');
  assert.equal(st.total.counted, 120);
  assert.equal(st.total.justified, 240);
});
test('20 % : passé / à venir, matière terminée', () => {
  const tt = mini(4, {});
  const id = w => `${Core.addDays('2026-09-21', 7 * w)}#0`;
  // lundi 28 sept. 8h30 = début de la 2e séance → elle est « passée », pas la 3e
  let st = Core.computeStats(tt, { [id(1)]: 'A', [id(2)]: 'A' }, 'planned', { date: '2026-09-28', minutes: 510 });
  assert.equal(sub(st, 'DATA').absPast, 120);
  assert.equal(sub(st, 'DATA').absFuture, 120);
  assert.equal(sub(st, 'DATA').nUpcoming, 2);
  st = Core.computeStats(tt, { [id(1)]: 'A', [id(2)]: 'A' }, 'planned', { date: '2026-09-28', minutes: 509 });
  assert.equal(sub(st, 'DATA').absPast, 0);
  st = Core.computeStats(tt, {}, 'planned', { date: '2027-06-01', minutes: 0 });
  assert.equal(sub(st, 'DATA').status, 'done');
  assert.equal(sub(st, 'GIPEX').status, 'none');
  assert.equal(Object.keys(st.locked).length, 0);
});
test('20 % : séances de durées différentes (LV2 3 h et 1 h 30)', () => {
  const tt = mini(0, { 0: 180, 1: 90, 2: 90, 3: 180, 4: 180, 5: 180, 6: 180, 7: 180 });   // 21 h comme dans l'Excel
  const now = { date: '2026-09-01', minutes: 0 };
  const id = w => `${Core.addDays('2026-09-21', 7 * w + 3)}#0`;
  let st = Core.computeStats(tt, {}, 'strict', now);
  assert.equal(sub(st, 'LV2').planned, 1260);
  assert.equal(sub(st, 'LV2').ref, 1200);                  // min(21 h, 20 h)
  assert.equal(sub(st, 'LV2').limit, 240);                 // 4 h
  assert.equal(sub(st, 'LV2').canMiss, 2);                 // les deux séances d'1 h 30
  st = Core.computeStats(tt, { [id(0)]: 'A' }, 'strict', now);   // 3 h manquées, il reste 1 h
  assert.equal(sub(st, 'LV2').status, 'locked');
  assert.ok(st.locked[id(1)] && st.locked[id(3)]);
  st = Core.computeStats(tt, { [id(1)]: 'A' }, 'strict', now);   // 1 h 30 manquée, il reste 2 h 30
  assert.equal(sub(st, 'LV2').status, 'last');
  assert.ok(!st.locked[id(2)] && st.locked[id(3)]);        // l'autre 1 h 30 passe encore, pas une séance de 3 h
});

/* ── le vrai fichier Excel, s'il est là ── */
const xlsx = process.argv[2] || path.join(here, '..', '..', 'emploi-du-temps-3A_01nov.xlsx');
if (fs.existsSync(xlsx)) {
  const bytes = new Uint8Array(fs.readFileSync(xlsx));
  const tt = Core.parseXlsx(bytes, path.basename(xlsx));
  const sessions = Core.listSessions(tt);
  const hours = id => sessions.filter(s => s.sub === id).reduce((a, s) => a + s.m, 0) / 60;
  const day = (monday, d) => tt.weeks.find(w => w.monday === monday).days[d];
  test('Excel : dézippage du classeur', () => {
    const zip = Core.unzip(bytes);
    assert.ok(zip.names.includes('xl/worksheets/sheet1.xml'));
    assert.match(zip.text('xl/workbook.xml'), /<sheet name="Feuil1"/);
    assert.ok(zip.text('xl/worksheets/sheet1.xml').endsWith('</worksheet>'));
  });
  test('Excel : 19 semaines, année recalée en janvier', () => {
    assert.equal(tt.weeks.length, 19);
    assert.equal(tt.weeks[0].monday, '2026-09-21');
    assert.equal(tt.weeks[15].monday, '2027-01-04');
    assert.equal(tt.weeks[18].monday, '2027-01-25');
    assert.deepEqual(tt.warnings, []);
    assert.deepEqual(tt.times[0], [[510, 620], [640, 750], [840, 950], [970, 1080]]);
    assert.deepEqual(tt.times[4], [[510, 620], [640, 750], [870, 980], [1000, 1110]]);   // vendredi après-midi décalé
  });
  test('Excel : volumes par matière', () => {
    assert.deepEqual(Core.SUBJECTS.map(s => [s.id, hours(s.id)]),
      [['GIPEX', 62], ['SGSE', 56], ['DATA', 60], ['ROBOT', 56], ['PROJET', 52], ['LV2', 21], ['AN9', 20], ['APE9', 14]]);
    assert.equal(new Set(sessions.map(s => s.id)).size, sessions.length);       // identifiants uniques
  });
  test('Excel : LV2 = groupe arabe (ZT) uniquement', () => {
    const lv2 = sessions.filter(s => s.sub === 'LV2').map(s => `${s.date} s${s.s} n${s.n} ${s.m}`);
    assert.deepEqual(lv2, ['2026-10-15 s0 n2 180', '2026-10-29 s1 n1 90', '2026-11-12 s1 n1 90', '2026-11-16 s0 n2 180',
      '2026-11-26 s0 n2 180', '2026-11-30 s0 n2 180', '2026-12-03 s0 n2 180', '2026-12-10 s0 n2 180']);
    assert.ok(!sessions.some(s => /\(MA\)/.test(s.t)));
    assert.deepEqual(day('2026-10-05', 3), []);            // jeudi 8 oct. : seulement l'espagnol → rien pour moi
  });
  test('Excel : semaine du 16 novembre', () => {
    // libellés comparés sous leur forme publique (sans nom complet de personne), comme dans data.js
    const show = bl => bl.map(b => `${b.s}+${b.n} ${b.k} ${publicLabel(b.t)}`);
    assert.deepEqual(show(day('2026-11-16', 0)), ['0+2 c LV2 (ZT) 3h', '2+1 c GIPEX (MT+IEH)', '3+1 c GIPEX (MT+IEH)']);
    assert.deepEqual(show(day('2026-11-16', 1)), ['0+1 x Stage/poursuite étude', '1+1 c Data (NF) info', '2+1 c Data (NF) info', '3+1 c Data (NF) info']);
    assert.deepEqual(show(day('2026-11-16', 2)), ['0+4 o FERIE']);
    assert.deepEqual(show(day('2026-11-16', 3)), ['0+1 c Data (NF) info', '1+1 c Data (NF) info', '2+2 x Conférence']);
    assert.deepEqual(show(day('2026-11-16', 4)), ['0+1 c Data (NF) info', '1+1 c Data (NF) info', '2+1 c Data (NF) info', '3+1 x PJT9']);
  });
  test('Excel : blocs fusionnés, vacances, cases grisées', () => {
    const show = bl => bl.map(b => `${b.s}+${b.n} ${b.k} ${b.t}`);
    assert.deepEqual(show(day('2026-12-14', 1)), ['0+1 c Robotique (AO)', '1+1 c Robotique (AO)', '2+1 c Robotique (AO)', '3+1 x PJT9']);
    assert.deepEqual(show(day('2026-10-19', 1)), ['0+4 x FORUM ART ET METIERS CAMPUS PARIS']);
    assert.deepEqual(show(day('2026-11-02', 4)), ['0+4 o VACANCES']);
    assert.deepEqual(show(day('2026-12-21', 2)), ['0+4 o ']);            // mer. 23 déc. : case grise sans texte
    assert.deepEqual(show(day('2027-01-25', 3)), ['0+4 o ']);
    assert.deepEqual(show(day('2027-01-11', 0)), ['0+4 o FERIE']);
    assert.deepEqual(show(day('2026-10-26', 3)), ['0+1 c Data (AH) info', '1+1 c LV2 (ZT) 1h30', '2+2 x Soutenance PJT9']);
    assert.ok(tt.weeks.every(w => w.days.length === 6 && w.days[5].length === 0));   // rien le samedi
  });
  test('Excel : data.js est à jour', () => {
    const ctx = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(here, '..', 'data.js'), 'utf8'), ctx);
    const fresh = publicTimetable(JSON.parse(JSON.stringify(tt))); delete fresh.warnings;
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.window.DEFAULT_TIMETABLE)), fresh);
  });
  test('Excel : aucun nom complet dans les données publiques', () => {
    const labels = [...new Set(publicTimetable(JSON.parse(JSON.stringify(tt))).weeks.flatMap(w => w.days.flat().map(b => b.t)))];
    assert.ok(labels.includes('Conférence') && labels.includes('SGSE (SA)') && labels.includes('Conf TE.'));
    assert.ok(labels.includes('Robotique (RB+RBe) info') && labels.includes('GIPEX(supply chain)') && labels.includes('AN9 (Sana)'));
    assert.deepEqual(labels.filter(t => /^Conf\. /.test(t)), []);
    assert.deepEqual(labels.filter(t => /\(([^)]*)\)/.test(t) && /\p{Lu}{1,2}\p{Ll}{4,}/u.test(t.match(/\(([^)]*)\)/)[1])), []);
    assert.equal(publicLabel('Data (WZ) info'), 'Data (WZ) info');
  });
  test('Excel : marges réelles, base stricte', () => {
    const st = Core.computeStats(tt, {}, 'strict', { date: '2026-11-15', minutes: 600 });
    assert.deepEqual(st.subjects.map(s => [s.id, s.ref / 60, +(s.limit / 60).toFixed(2), s.canMiss, s.status]), [
      ['GIPEX', 60, 12, 6, 'ok'], ['SGSE', 56, 11.2, 5, 'ok'], ['DATA', 50, 10, 5, 'ok'], ['ROBOT', 50, 10, 5, 'ok'],
      ['PROJET', 50, 10, 5, 'ok'], ['LV2', 20, 4, 1, 'last'], ['AN9', 20, 4, 2, 'ok'], ['APE9', 14, 2.8, 0, 'done']]);
    assert.equal(st.total.ref, 320 * 60);
  });
} else {
  console.log('  --  fichier Excel introuvable, tests sur le vrai emploi du temps ignorés : ' + xlsx);
}
console.log(`\n${passed} tests réussis`);
