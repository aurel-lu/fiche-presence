# Fiche de présence

Petite web app personnelle pour suivre ses absences en cours et savoir, matière par matière,
si l'on peut encore en manquer une sans dépasser 20 % d'absence.

- **Semaine** : l'emploi du temps de la semaine choisie. Toucher un cours le marque absent,
  un deuxième appui le passe en absence justifiée (non comptée), un troisième le remet présent.
- **Camembert** des heures manquées par matière, et proportion d'heures manquées sur le semestre.
- **Marge par matière** : heures manquées sur les heures autorisées (20 % du volume), avec un verdict
  (« encore 10 h de marge », « dernière absence possible », « plus aucune absence possible »…).
  Un cadenas signale dans la semaine les cours qu'on ne peut plus manquer.
- **Import Excel** : un nouvel emploi du temps (.xlsx, même mise en page) se charge depuis les réglages,
  les absences déjà saisies sont conservées.
- Fonctionne hors-ligne une fois ouverte. Les absences restent sur l'appareil ; les réglages
  permettent d'exporter et de restaurer une sauvegarde.

Aucune dépendance, aucun serveur : des fichiers statiques.

## Installer sur iPhone

Ouvrir le site dans Safari, bouton Partager, « Sur l'écran d'accueil ».

## Développement

```bash
node tools/serve.mjs          # http://localhost:5173/
node tools/test.mjs           # tests du lecteur d'Excel et du calcul des 20 %
node tools/build-data.mjs "chemin/vers/emploi-du-temps.xlsx"   # régénère data.js
```

`data.js` est l'emploi du temps intégré. Il est produit par `tools/build-data.mjs`, qui retire
les noms complets de personnes (ce dépôt est public) et ne garde que les codes des enseignants.

Après une modification mise en ligne, changer `VERSION` dans `sw.js` : c'est ce qui fait
renouveler le cache hors-ligne sur les téléphones.

| Fichier | Rôle |
|---|---|
| `core.js` | lecture du .xlsx (dézippage et XML), liste des séances, calcul des marges |
| `app.js`, `styles.css`, `index.html` | interface |
| `data.js` | emploi du temps intégré (généré) |
| `sw.js`, `manifest.webmanifest`, `icons/` | installation et mode hors-ligne |
