// Régénère data.js (l'emploi du temps intégré à l'app) à partir d'un fichier Excel.
//   node tools/build-data.mjs "chemin/vers/emploi-du-temps.xlsx"
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { publicTimetable } from './public-labels.mjs';

const require = createRequire(import.meta.url);
const Core = require('../core.js');
const here = path.dirname(fileURLToPath(import.meta.url));

const file = process.argv[2];
if (!file) { console.error('Usage : node tools/build-data.mjs <fichier.xlsx>'); process.exit(1); }

const tt = publicTimetable(Core.parseXlsx(new Uint8Array(fs.readFileSync(file)), path.basename(file)));
const warnings = tt.warnings; delete tt.warnings;
fs.writeFileSync(path.join(here, '..', 'data.js'),
  '/* Généré par tools/build-data.mjs — ne pas modifier à la main. */\n' +
  'window.DEFAULT_TIMETABLE = ' + JSON.stringify(tt) + ';\n');

const sessions = Core.listSessions(tt);
console.log(`${tt.weeks.length} semaines, du ${tt.weeks[0].monday} au ${tt.weeks[tt.weeks.length - 1].monday}, ${sessions.length} séances suivies`);
for (const s of Core.SUBJECTS) {
  const min = sessions.filter(x => x.sub === s.id).reduce((a, x) => a + x.m, 0);
  console.log(`  ${s.name.padEnd(16)} ${Core.fmtH(min).padStart(7)}  (officiel ${s.official} h)`);
}
if (warnings.length) { console.log('\nAvertissements :'); warnings.forEach(w => console.log('  - ' + w)); }
