// Ce site est public : l'emploi du temps intégré (data.js) garde les libellés de l'Excel,
// mais sans les noms complets de personnes. Les codes et initiales des enseignants restent.
// L'import d'un Excel dans l'app, lui, ne retire rien : ces données restent sur le téléphone.

export function publicLabel(label) {
  return label
    // « Conf. Prénom Nom » → « Conf. » (« Conf TE. », nom d'entreprise, n'est pas touché)
    .replace(/^Conf\.\s+\p{Lu}\p{Ll}+(\s+\p{Lu}[\p{L}'’-]*)+$/u, 'Conf.')
    // entre parenthèses, un nom de famille écrit en entier est réduit à ses majuscules : « (JDupont) » → « (JD) »
    .replace(/\(([^)]*)\)/g, (m, inner) =>
      '(' + inner.replace(/\b\p{Lu}{1,2}\p{Ll}{4,}\b/gu, word => word.replace(/\p{Ll}/gu, '')) + ')');
}

export function publicTimetable(tt) {
  tt.weeks.forEach(w => w.days.forEach(blocks => blocks.forEach(b => { b.t = publicLabel(b.t); })));
  return tt;
}
