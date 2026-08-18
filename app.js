/* ============================================================
   1. CONNEXION À SUPABASE
   ============================================================
   La clé ci-dessous est la clé "publishable" : elle est conçue pour être
   visible dans le code source d'une page. Elle ne donne accès à rien par
   elle-même — c'est la sécurité au niveau des lignes (RLS) côté base qui
   exige d'être connecté. Voir schema-supabase.sql.
   ------------------------------------------------------------ */

const SUPABASE_URL = 'https://qafiwvnokwajkduoajna.supabase.co';
const SUPABASE_CLE  = 'sb_publishable_waMjF2DZrWBLRen4QqZaLA_HVSSHsOS';

// On nomme le client "bdd" (et pas "supabase") pour ne pas le confondre
// avec la librairie elle-même, qui occupe déjà window.supabase.
const bdd = window.supabase.createClient(SUPABASE_URL, SUPABASE_CLE);


/* ============================================================
   2. ÉTAT DE L'APPLICATION
   ============================================================
   Toutes les données sont chargées une fois au démarrage, gardées en
   mémoire pour un affichage instantané, et réécrites dans Supabase à
   chaque modification.
   ------------------------------------------------------------ */

const DATE_DEBUT = '2026-08-17';   // premier jour du suivi
const RECORD_RAMEUR_INITIAL = '4:06'; // record à battre sur 1000 m
const OBJECTIF_EAU = 200;           // cl

let donnees = {
  jours: {},    // { "2026-08-17": {kine_exo, sport, kine_seance, regime, velo, douleur, douleur_note, eau} }
  poids: [],    // [{ id, date, weight }]
  rameur: [],   // [{ id, date, temps }]
  tapis: []     // [{ id, date, duree, vitesse, inclinaison }]
};

const ACTIVITES = ['kine_exo', 'sport', 'kine_seance', 'regime', 'velo'];

let moisAffiche = new Date();
let jourSelectionne = null;


/* ============================================================
   3. OUTILS DE DATE
   ============================================================
   Important : on n'utilise jamais toISOString(), qui renvoie la date en
   heure UTC — entre minuit et 2 h du matin en France, elle donnerait la
   veille. Tout est calculé en heure locale.
   ------------------------------------------------------------ */

function cleDate(dateObjet) {
  const annee = dateObjet.getFullYear();
  const mois = String(dateObjet.getMonth() + 1).padStart(2, '0');
  const jour = String(dateObjet.getDate()).padStart(2, '0');
  return `${annee}-${mois}-${jour}`;
}

function aujourdhui() {
  return cleDate(new Date());
}

// "2026-08-17" -> objet Date local (le T00:00:00 évite l'interprétation UTC)
function versDate(cle) {
  return new Date(cle + 'T00:00:00');
}

function dateCourte(cle) {
  return versDate(cle).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// Toutes les dates du début du suivi jusqu'à aujourd'hui, dans l'ordre.
function clesDepuisDebut() {
  const cles = [];
  const curseur = versDate(DATE_DEBUT);
  const fin = new Date();
  fin.setHours(0, 0, 0, 0);
  while (curseur <= fin) {
    cles.push(cleDate(curseur));
    curseur.setDate(curseur.getDate() + 1);
  }
  return cles;
}

// Conversions pour l'export / import : jj/mm/aaaa <-> aaaa-mm-jj
function isoVersFr(iso) {
  const [a, m, j] = iso.split('-');
  return `${j}/${m}/${a}`;
}
function frVersIso(fr) {
  const [j, m, a] = fr.split('/');
  return `${a}-${m.padStart(2, '0')}-${j.padStart(2, '0')}`;
}
// Accepte les deux formats et renvoie toujours de l'ISO.
function normaliserDate(valeur) {
  if (typeof valeur !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return valeur;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(valeur)) return frVersIso(valeur);
  return null;
}


/* ============================================================
   4. BARRE DE STATUT (retour visuel de chaque enregistrement)
   ============================================================ */

let minuteurStatut = null;

function afficherStatut(texte, type) {
  const barre = document.getElementById('statut');
  barre.textContent = texte;
  barre.className = 'visible ' + type;   // type : chargement | ok | erreur
  clearTimeout(minuteurStatut);
  if (type !== 'chargement') {
    const duree = type === 'erreur' ? 5000 : 1800;
    minuteurStatut = setTimeout(() => { barre.className = ''; }, duree);
  }
}

function masquerStatut() {
  clearTimeout(minuteurStatut);
  document.getElementById('statut').className = '';
}

/* Enveloppe commune à tous les appels à la base : affiche
   "Enregistrement…", puis "Enregistré ✓" ou le message d'erreur.
   Renvoie true si tout s'est bien passé. */
async function executer(action, messageSucces) {
  afficherStatut('Enregistrement…', 'chargement');
  try {
    const { error } = await action();
    if (error) {
      afficherStatut('Erreur : ' + error.message, 'erreur');
      return false;
    }
    if (messageSucces) afficherStatut(messageSucces, 'ok');
    else masquerStatut();
    return true;
  } catch (e) {
    // Typiquement : pas de réseau.
    afficherStatut('Pas de connexion — modification non enregistrée', 'erreur');
    return false;
  }
}


/* ============================================================
   5. CHARGEMENT DES DONNÉES
   ============================================================ */

async function chargerDonnees() {
  afficherStatut('Chargement…', 'chargement');
  try {
    const [resJours, resPoids, resRameur, resTapis] = await Promise.all([
      bdd.from('days').select('*'),
      bdd.from('weights').select('*').order('date', { ascending: true }),
      bdd.from('rameur').select('*').order('date', { ascending: false }),
      bdd.from('tapis').select('*').order('date', { ascending: false })
    ]);

    const erreur = resJours.error || resPoids.error || resRameur.error || resTapis.error;
    if (erreur) {
      afficherStatut('Erreur de chargement : ' + erreur.message, 'erreur');
      return false;
    }

    donnees.jours = {};
    (resJours.data || []).forEach(ligne => { donnees.jours[ligne.date] = ligne; });
    donnees.poids  = resPoids.data  || [];
    donnees.rameur = resRameur.data || [];
    donnees.tapis  = resTapis.data  || [];

    masquerStatut();
    return true;
  } catch (e) {
    afficherStatut('Pas de connexion à la base', 'erreur');
    return false;
  }
}

// Redessine toute l'interface à partir de l'état en mémoire.
function toutAfficher() {
  afficherCompteurJours();
  afficherCalendrier();
  afficherAujourdhui();
  afficherBadges();
  afficherCourbePoids();
  afficherListePoids();
  afficherListeRameur();
  afficherListeTapis();
}


/* ============================================================
   6. ENREGISTREMENT D'UN JOUR
   ============================================================
   La table days a "date" pour clé primaire : on envoie la ligne complète
   et Supabase remplace celle qui existe déjà (upsert).
   ------------------------------------------------------------ */

function jourEnMemoire(cle) {
  if (!donnees.jours[cle]) {
    donnees.jours[cle] = {
      date: cle,
      kine_exo: false, sport: false, kine_seance: false,
      regime: false, velo: false,
      douleur: null, douleur_note: null, eau: 0
    };
  }
  return donnees.jours[cle];
}

async function sauvegarderJour(cle, messageSucces) {
  const jour = jourEnMemoire(cle);
  const ligne = {
    date: cle,
    kine_exo: !!jour.kine_exo,
    sport: !!jour.sport,
    kine_seance: !!jour.kine_seance,
    regime: !!jour.regime,
    velo: !!jour.velo,
    douleur: (jour.douleur === null || jour.douleur === undefined) ? null : Number(jour.douleur),
    douleur_note: jour.douleur_note || null,
    eau: Number(jour.eau) || 0
  };
  return executer(
    () => bdd.from('days').upsert(ligne, { onConflict: 'date' }),
    messageSucces
  );
}


/* ============================================================
   7. COMPTEUR DE JOURS
   ============================================================ */

function afficherCompteurJours() {
  const debut = versDate(DATE_DEBUT);
  const maintenant = new Date();
  maintenant.setHours(0, 0, 0, 0);
  const nbJours = Math.round((maintenant - debut) / 86400000) + 1;
  const element = document.getElementById('compteurJours');
  if (nbJours < 1) {
    element.textContent = `Départ le ${versDate(DATE_DEBUT).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
  } else {
    element.textContent = `Jour ${nbJours} depuis le début`;
  }
}


/* ============================================================
   8. CALENDRIER
   ============================================================ */

function couleurDouleur(niveau) {
  if (niveau <= 3) return '#6b8f7c';   // vert
  if (niveau <= 6) return '#c9a227';   // jaune
  return '#b5654a';                    // rouge
}

function afficherCalendrier() {
  const annee = moisAffiche.getFullYear();
  const mois = moisAffiche.getMonth();
  document.getElementById('libelleMois').textContent =
    moisAffiche.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const grille = document.getElementById('grilleCalendrier');
  grille.innerHTML = '';

  ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach(lettre => {
    const entete = document.createElement('div');
    entete.className = 'cal-dow';
    entete.textContent = lettre;
    grille.appendChild(entete);
  });

  // getDay() renvoie 0 pour dimanche : on décale pour commencer le lundi.
  let decalage = new Date(annee, mois, 1).getDay() - 1;
  if (decalage < 0) decalage = 6;
  for (let i = 0; i < decalage; i++) {
    const vide = document.createElement('div');
    vide.className = 'cal-day empty';
    grille.appendChild(vide);
  }

  const nbJoursDansMois = new Date(annee, mois + 1, 0).getDate();
  const cleAujourdhui = aujourdhui();

  for (let numero = 1; numero <= nbJoursDansMois; numero++) {
    const dateObjet = new Date(annee, mois, numero);
    const cle = cleDate(dateObjet);
    const jour = donnees.jours[cle] || {};

    const case_ = document.createElement('div');
    case_.className = 'cal-day'
      + (cle === cleAujourdhui ? ' today' : '')
      + (cle === jourSelectionne ? ' selectionne' : '');

    // Barre de douleur : uniquement si la douleur a été renseignée.
    // Attention : 0 est une valeur valide (aucune douleur), null = non renseigné.
    let barreDouleur = '';
    if (jour.douleur !== null && jour.douleur !== undefined) {
      const couleur = couleurDouleur(jour.douleur);
      const opacite = 0.35 + (jour.douleur / 10) * 0.65;
      barreDouleur = `<div class="pain-bar" style="background:${couleur}; opacity:${opacite};"></div>`;
    }

    const drapeau = (cle === DATE_DEBUT)
      ? '<span style="position:absolute;top:1px;right:2px;font-size:0.55rem;">🚩</span>' : '';

    const pastilles = ACTIVITES
      .map(cleActivite => `<span class="dot ${jour[cleActivite] ? 'on ' + cleActivite : ''}"></span>`)
      .join('');

    case_.innerHTML = `${drapeau}<span class="num">${numero}</span><div class="dots">${pastilles}</div>${barreDouleur}`;
    case_.addEventListener('click', () => ouvrirPanneauJour(cle));
    grille.appendChild(case_);
  }
}

function ouvrirPanneauJour(cle) {
  jourSelectionne = cle;
  const panneau = document.getElementById('panneauJour');
  panneau.classList.add('open');

  document.getElementById('titreJour').textContent =
    versDate(cle).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  const jour = donnees.jours[cle] || {};
  document.querySelectorAll('#panneauJour .switch').forEach(interrupteur => {
    interrupteur.classList.toggle('on', !!jour[interrupteur.dataset.cle]);
  });

  const douleurRenseignee = jour.douleur !== null && jour.douleur !== undefined;
  document.getElementById('curseurDouleurPanneau').value = douleurRenseignee ? jour.douleur : 0;
  document.getElementById('valeurDouleurPanneau').textContent = douleurRenseignee ? jour.douleur : '–';
  document.getElementById('noteDouleurPanneau').value = jour.douleur_note || '';

  afficherCalendrier();  // pour surligner la case sélectionnée
  panneau.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Les interrupteurs du panneau enregistrent immédiatement.
document.querySelectorAll('#panneauJour .switch').forEach(interrupteur => {
  interrupteur.addEventListener('click', async () => {
    if (!jourSelectionne) return;
    const cle = interrupteur.dataset.cle;
    const jour = jourEnMemoire(jourSelectionne);
    jour[cle] = !jour[cle];
    interrupteur.classList.toggle('on', jour[cle]);
    await sauvegarderJour(jourSelectionne, 'Enregistré ✓');
    afficherCalendrier();
    afficherBadges();
    if (jourSelectionne === aujourdhui()) afficherAujourdhui();
  });
});

const curseurDouleurPanneau = document.getElementById('curseurDouleurPanneau');
curseurDouleurPanneau.addEventListener('input', () => {
  document.getElementById('valeurDouleurPanneau').textContent = curseurDouleurPanneau.value;
});

document.getElementById('btnEnregistrerPanneau').addEventListener('click', async () => {
  if (!jourSelectionne) return;
  const jour = jourEnMemoire(jourSelectionne);
  jour.douleur = parseInt(curseurDouleurPanneau.value, 10);
  jour.douleur_note = document.getElementById('noteDouleurPanneau').value.trim() || null;
  await sauvegarderJour(jourSelectionne, 'Jour enregistré ✓');
  afficherCalendrier();
  afficherBadges();
  if (jourSelectionne === aujourdhui()) afficherAujourdhui();
});

document.getElementById('btnMoisPrecedent').addEventListener('click', () => {
  moisAffiche.setMonth(moisAffiche.getMonth() - 1);
  afficherCalendrier();
});
document.getElementById('btnMoisSuivant').addEventListener('click', () => {
  moisAffiche.setMonth(moisAffiche.getMonth() + 1);
  afficherCalendrier();
});


/* ============================================================
   9. SECTION "AUJOURD'HUI"
   ============================================================ */

function afficherAujourdhui() {
  const jour = donnees.jours[aujourdhui()] || {};

  document.querySelectorAll('.today-btn').forEach(bouton => {
    bouton.classList.toggle('done', !!jour[bouton.dataset.cle]);
  });

  const douleurRenseignee = jour.douleur !== null && jour.douleur !== undefined;
  document.getElementById('curseurDouleurJour').value = douleurRenseignee ? jour.douleur : 0;
  document.getElementById('valeurDouleurJour').textContent = douleurRenseignee ? jour.douleur : '–';
  document.getElementById('noteDouleurJour').value = jour.douleur_note || '';

  const eau = jour.eau || 0;
  document.getElementById('curseurEau').value = eau;
  document.getElementById('valeurEau').textContent = `${eau} cl`;
}

// Les 5 gros boutons : un appui coche ou décoche l'activité du jour.
document.querySelectorAll('.today-btn').forEach(bouton => {
  bouton.addEventListener('click', async () => {
    const cle = bouton.dataset.cle;
    const jour = jourEnMemoire(aujourdhui());
    jour[cle] = !jour[cle];
    bouton.classList.toggle('done', jour[cle]);   // retour immédiat, avant même la réponse du serveur
    const ok = await sauvegarderJour(aujourdhui(), jour[cle] ? 'Coché ✓' : 'Décoché');
    if (!ok) {
      // L'enregistrement a échoué : on remet le bouton dans son état d'avant.
      jour[cle] = !jour[cle];
      bouton.classList.toggle('done', jour[cle]);
      return;
    }
    afficherCalendrier();
    afficherBadges();
  });
});

const curseurDouleurJour = document.getElementById('curseurDouleurJour');
curseurDouleurJour.addEventListener('input', () => {
  document.getElementById('valeurDouleurJour').textContent = curseurDouleurJour.value;
});

document.getElementById('btnEnregistrerDouleurJour').addEventListener('click', async () => {
  const jour = jourEnMemoire(aujourdhui());
  jour.douleur = parseInt(curseurDouleurJour.value, 10);
  jour.douleur_note = document.getElementById('noteDouleurJour').value.trim() || null;
  await sauvegarderJour(aujourdhui(), 'Douleur enregistrée ✓');
  afficherCalendrier();
});

const curseurEau = document.getElementById('curseurEau');
curseurEau.addEventListener('input', () => {
  document.getElementById('valeurEau').textContent = `${curseurEau.value} cl`;
});
// "change" (et pas "input") : on n'enregistre qu'une fois le doigt relâché.
curseurEau.addEventListener('change', async () => {
  const jour = jourEnMemoire(aujourdhui());
  jour.eau = parseInt(curseurEau.value, 10);
  const message = jour.eau >= OBJECTIF_EAU ? 'Objectif 2 L atteint ✓' : 'Eau enregistrée ✓';
  await sauvegarderJour(aujourdhui(), message);
});


/* ============================================================
   10. BADGES
   ============================================================ */

// "4:06" -> 246 secondes
function tempsEnSecondes(texte) {
  if (!texte) return null;
  const morceaux = texte.split(':');
  if (morceaux.length !== 2) return null;
  const minutes = parseInt(morceaux[0], 10);
  const secondes = parseInt(morceaux[1], 10);
  if (isNaN(minutes) || isNaN(secondes)) return null;
  return minutes * 60 + secondes;
}

/* Compte les jours consécutifs remplissant une condition, en remontant
   depuis aujourd'hui. Si la journée en cours n'est pas encore cochée, on
   ne casse pas la série : elle n'est pas terminée, on repart d'hier. */
function calculerSerie(condition) {
  const cles = clesDepuisDebut().reverse();
  let serie = 0;
  for (let i = 0; i < cles.length; i++) {
    const jour = donnees.jours[cles[i]];
    if (jour && condition(jour)) {
      serie++;
    } else if (i === 0) {
      continue;   // aujourd'hui pas encore rempli : on ne compte pas, mais on continue
    } else {
      break;
    }
  }
  return serie;
}

function calculerBadges() {
  const auMoinsUneActivite = jour => ACTIVITES.some(cle => jour[cle]);
  const serieActivite = calculerSerie(auMoinsUneActivite);
  const serieRegime = calculerSerie(jour => jour.regime);

  const listeJours = Object.values(donnees.jours);
  const nbSeancesKine = listeJours.filter(jour => jour.kine_seance).length;
  const nbExosMaison = listeJours.filter(jour => jour.kine_exo).length;

  const poidsReleves = donnees.poids.map(entree => Number(entree.weight)).filter(v => !isNaN(v));
  const poidsMini = poidsReleves.length ? Math.min(...poidsReleves) : null;

  const tempsRameur = donnees.rameur.map(entree => tempsEnSecondes(entree.temps)).filter(v => v !== null);
  const meilleurRameur = tempsRameur.length ? Math.min(...tempsRameur) : null;
  const recordABattre = tempsEnSecondes(RECORD_RAMEUR_INITIAL);

  const auMoinsUnJourCoche = listeJours.some(auMoinsUneActivite);

  return [
    { icone: '🏁', libelle: 'Premier jour coché', obtenu: auMoinsUnJourCoche },
    { icone: '🔥', libelle: "3 jours d'affilée",  obtenu: serieActivite >= 3 },
    { icone: '🔥', libelle: "7 jours d'affilée",  obtenu: serieActivite >= 7 },
    { icone: '🔥', libelle: "14 jours d'affilée", obtenu: serieActivite >= 14 },
    { icone: '🥗', libelle: '7 jours sans écart', obtenu: serieRegime >= 7 },
    { icone: '🧑‍⚕️', libelle: '5 séances kiné', obtenu: nbSeancesKine >= 5 },
    { icone: '🏠', libelle: '10 exos maison',     obtenu: nbExosMaison >= 10 },
    { icone: '⚖️', libelle: 'Sous les 95 kg',     obtenu: poidsMini !== null && poidsMini < 95 },
    { icone: '⚖️', libelle: 'Sous les 90 kg',     obtenu: poidsMini !== null && poidsMini < 90 },
    { icone: '⚖️', libelle: 'Sous les 85 kg',     obtenu: poidsMini !== null && poidsMini < 85 },
    { icone: '🏆', libelle: 'Sous les 80 kg',     obtenu: poidsMini !== null && poidsMini < 80 },
    { icone: '🚣', libelle: 'Record rameur battu', obtenu: meilleurRameur !== null && meilleurRameur < recordABattre }
  ];
}

function afficherBadges() {
  document.getElementById('grilleBadges').innerHTML = calculerBadges().map(badge => `
    <div class="badge ${badge.obtenu ? 'unlocked' : ''}">
      <span class="icon">${badge.icone}</span>
      <span class="label">${badge.libelle}</span>
    </div>
  `).join('');
}


/* ============================================================
   11. POIDS
   ============================================================ */

document.getElementById('btnAjouterPoids').addEventListener('click', async () => {
  const date = document.getElementById('champDatePoids').value;
  const valeur = parseFloat(document.getElementById('champPoids').value);

  if (!date) { afficherStatut('Choisis une date', 'erreur'); return; }
  if (isNaN(valeur) || valeur <= 0) { afficherStatut('Saisis un poids valide', 'erreur'); return; }

  // La colonne date est unique : upsert remplace la pesée du jour si elle existe.
  const ok = await executer(
    () => bdd.from('weights').upsert({ date: date, weight: valeur }, { onConflict: 'date' }),
    'Poids enregistré ✓'
  );
  if (!ok) return;

  const existante = donnees.poids.find(entree => entree.date === date);
  if (existante) existante.weight = valeur;
  else donnees.poids.push({ date: date, weight: valeur });
  donnees.poids.sort((a, b) => a.date.localeCompare(b.date));

  document.getElementById('champPoids').value = '';
  afficherCourbePoids();
  afficherListePoids();
  afficherBadges();
});

function afficherCourbePoids() {
  const zone = document.getElementById('zoneCourbePoids');
  const points = [...donnees.poids]
    .filter(entree => entree.weight !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (points.length === 0) {
    zone.innerHTML = '<div class="empty-msg">Pas encore de pesée enregistrée.</div>';
    return;
  }
  if (points.length === 1) {
    zone.innerHTML = `<div class="empty-msg">Première pesée : ${points[0].weight} kg (${dateCourte(points[0].date)})<br>Une deuxième pesée fera apparaître la courbe.</div>`;
    return;
  }

  const valeurs = points.map(entree => Number(entree.weight));
  const mini = Math.min(...valeurs) - 1;
  const maxi = Math.max(...valeurs) + 1;

  const largeur = 360, hauteur = 190, marge = 26, margeHaut = 20;
  const pasX = (largeur - marge * 2) / (points.length - 1);
  const versY = valeur => hauteur - marge - ((valeur - mini) / (maxi - mini)) * (hauteur - marge - margeHaut);

  const ligne = points.map((entree, i) => `${marge + i * pasX},${versY(entree.weight)}`).join(' ');

  // Au-delà de 10 pesées, les étiquettes se chevaucheraient :
  // on n'affiche alors que la première, la dernière et la plus basse.
  const indexPlusBas = valeurs.indexOf(Math.min(...valeurs));
  const afficherToutesLesValeurs = points.length <= 10;

  const cercles = points.map((entree, i) => {
    const x = marge + i * pasX;
    const y = versY(entree.weight);
    const montrer = afficherToutesLesValeurs || i === 0 || i === points.length - 1 || i === indexPlusBas;
    const etiquette = montrer
      ? `<text x="${x}" y="${y - 9}" font-size="10" font-family="-apple-system,sans-serif" fill="#1f2d28" text-anchor="middle">${entree.weight}</text>`
      : '';
    return `<circle cx="${x}" cy="${y}" r="3.5" fill="#47665a"/>${etiquette}`;
  }).join('');

  zone.innerHTML = `
    <svg viewBox="0 0 ${largeur} ${hauteur}" style="width:100%; height:auto; display:block; margin-top:10px;">
      <line x1="${marge}" y1="${versY(mini)}" x2="${largeur - marge}" y2="${versY(mini)}" stroke="#f0ede4" stroke-width="1"/>
      <line x1="${marge}" y1="${versY(maxi)}" x2="${largeur - marge}" y2="${versY(maxi)}" stroke="#f0ede4" stroke-width="1"/>
      <polyline points="${ligne}" fill="none" stroke="#6b8f7c" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${cercles}
    </svg>
    <div style="display:flex; justify-content:space-between; font-family:var(--sans); font-size:0.72rem; color:#9a9284;">
      <span>${dateCourte(points[0].date)}</span>
      <span>${dateCourte(points[points.length - 1].date)}</span>
    </div>`;
}

function afficherListePoids() {
  const zone = document.getElementById('listePoids');
  if (donnees.poids.length === 0) { zone.innerHTML = ''; return; }

  const triees = [...donnees.poids].sort((a, b) => b.date.localeCompare(a.date));
  zone.innerHTML = triees.map(entree => `
    <div class="perf-entry">
      <span class="perf-date">${dateCourte(entree.date)}</span>
      <span class="perf-val">${entree.weight} kg</span>
      <button class="btn-suppr" data-table="weights" data-date="${entree.date}">✕</button>
    </div>`).join('');
}


/* ============================================================
   12. RAMEUR ET TAPIS
   ============================================================ */

document.getElementById('btnAjouterRameur').addEventListener('click', async () => {
  const date = document.getElementById('champDateRameur').value;
  const temps = document.getElementById('champTempsRameur').value.trim();

  if (!date) { afficherStatut('Choisis une date', 'erreur'); return; }
  // Même contrôle que la contrainte posée en base, pour un message clair.
  if (!/^\d{1,2}:[0-5]\d$/.test(temps)) {
    afficherStatut('Format attendu : 4:06', 'erreur');
    return;
  }

  const { data, error } = await bdd.from('rameur').insert({ date: date, temps: temps }).select();
  if (error) { afficherStatut('Erreur : ' + error.message, 'erreur'); return; }

  donnees.rameur.push(data[0]);
  document.getElementById('champTempsRameur').value = '';
  afficherStatut('Perf rameur ajoutée ✓', 'ok');
  afficherListeRameur();
  afficherBadges();
});

document.getElementById('btnAjouterTapis').addEventListener('click', async () => {
  const date = document.getElementById('champDateTapis').value;
  const duree = document.getElementById('champDureeTapis').value;
  const vitesse = document.getElementById('champVitesseTapis').value;
  const inclinaison = document.getElementById('champInclinaisonTapis').value;

  if (!date) { afficherStatut('Choisis une date', 'erreur'); return; }
  if (duree === '') { afficherStatut('Renseigne au moins la durée', 'erreur'); return; }

  const ligne = {
    date: date,
    duree: parseFloat(duree),
    vitesse: vitesse === '' ? null : parseFloat(vitesse),
    inclinaison: inclinaison === '' ? null : parseFloat(inclinaison)
  };

  const { data, error } = await bdd.from('tapis').insert(ligne).select();
  if (error) { afficherStatut('Erreur : ' + error.message, 'erreur'); return; }

  donnees.tapis.push(data[0]);
  document.getElementById('champDureeTapis').value = '';
  document.getElementById('champVitesseTapis').value = '';
  document.getElementById('champInclinaisonTapis').value = '';
  afficherStatut('Perf tapis ajoutée ✓', 'ok');
  afficherListeTapis();
});

function afficherListeRameur() {
  const zone = document.getElementById('listeRameur');
  if (donnees.rameur.length === 0) {
    zone.innerHTML = '<div class="empty-msg">Aucune donnée pour l\'instant.</div>';
    return;
  }
  const triees = [...donnees.rameur].sort((a, b) => b.date.localeCompare(a.date));
  zone.innerHTML = triees.map(entree => `
    <div class="perf-entry">
      <span class="perf-date">${dateCourte(entree.date)}</span>
      <span class="perf-val">${entree.temps} /1000 m</span>
      <button class="btn-suppr" data-table="rameur" data-id="${entree.id}">✕</button>
    </div>`).join('');
}

function afficherListeTapis() {
  const zone = document.getElementById('listeTapis');
  if (donnees.tapis.length === 0) {
    zone.innerHTML = '<div class="empty-msg">Aucune donnée pour l\'instant.</div>';
    return;
  }
  const triees = [...donnees.tapis].sort((a, b) => b.date.localeCompare(a.date));
  zone.innerHTML = triees.map(entree => {
    const morceaux = [`${entree.duree} min`];
    if (entree.vitesse !== null) morceaux.push(`${entree.vitesse} km/h`);
    if (entree.inclinaison !== null) morceaux.push(`${entree.inclinaison} %`);
    return `
      <div class="perf-entry">
        <span class="perf-date">${dateCourte(entree.date)}</span>
        <span class="perf-val">${morceaux.join(' · ')}</span>
        <button class="btn-suppr" data-table="tapis" data-id="${entree.id}">✕</button>
      </div>`;
  }).join('');
}


/* ============================================================
   13. SUPPRESSION D'UNE LIGNE
   ============================================================
   Confirmation en deux temps : le premier appui transforme le bouton en
   "Supprimer ?", le second supprime vraiment. Ça évite la fenêtre de
   confirmation du navigateur, peu agréable sur mobile.
   ------------------------------------------------------------ */

let boutonEnAttente = null;

function annulerConfirmation() {
  if (boutonEnAttente) {
    boutonEnAttente.textContent = '✕';
    boutonEnAttente.classList.remove('confirmer');
    boutonEnAttente = null;
  }
}

document.addEventListener('click', async evenement => {
  const bouton = evenement.target.closest('.btn-suppr');

  if (!bouton) { annulerConfirmation(); return; }

  if (bouton !== boutonEnAttente) {
    annulerConfirmation();
    boutonEnAttente = bouton;
    bouton.textContent = 'Supprimer ?';
    bouton.classList.add('confirmer');
    return;
  }

  // Deuxième appui sur le même bouton : on supprime.
  const table = bouton.dataset.table;
  annulerConfirmation();

  if (table === 'weights') {
    const date = bouton.dataset.date;
    const ok = await executer(() => bdd.from('weights').delete().eq('date', date), 'Pesée supprimée');
    if (!ok) return;
    donnees.poids = donnees.poids.filter(entree => entree.date !== date);
    afficherCourbePoids();
    afficherListePoids();
    afficherBadges();
  } else {
    const id = bouton.dataset.id;
    const ok = await executer(() => bdd.from(table).delete().eq('id', id), 'Ligne supprimée');
    if (!ok) return;
    if (table === 'rameur') {
      donnees.rameur = donnees.rameur.filter(entree => entree.id !== id);
      afficherListeRameur();
      afficherBadges();
    } else {
      donnees.tapis = donnees.tapis.filter(entree => entree.id !== id);
      afficherListeTapis();
    }
  }
});


/* ============================================================
   14. SAUVEGARDE : EXPORT ET IMPORT JSON
   ============================================================
   Les dates sont écrites en jj/mm/aaaa dans l'export (plus lisible) et
   reconverties en aaaa-mm-jj à l'import.
   ------------------------------------------------------------ */

function construireExport() {
  const jours = {};
  Object.keys(donnees.jours).sort().forEach(cle => {
    const jour = donnees.jours[cle];
    const sortie = {};
    ACTIVITES.forEach(activite => { if (jour[activite]) sortie[activite] = true; });
    if (jour.douleur !== null && jour.douleur !== undefined) sortie.douleur = jour.douleur;
    if (jour.douleur_note) sortie.douleur_note = jour.douleur_note;
    if (jour.eau) sortie.eau = jour.eau;
    if (Object.keys(sortie).length > 0) jours[isoVersFr(cle)] = sortie;
  });

  return {
    days: jours,
    weights: donnees.poids.map(e => ({ date: isoVersFr(e.date), weight: e.weight })),
    rameur: donnees.rameur.map(e => ({ date: isoVersFr(e.date), temps: e.temps })),
    tapis: donnees.tapis.map(e => ({
      date: isoVersFr(e.date), duree: e.duree, vitesse: e.vitesse, inclinaison: e.inclinaison
    }))
  };
}

document.getElementById('btnVoirSauvegarde').addEventListener('click', () => {
  const zoneTexte = document.getElementById('texteSauvegarde');
  zoneTexte.value = JSON.stringify(construireExport(), null, 2);
  zoneTexte.style.display = 'block';
  document.getElementById('btnCopierSauvegarde').style.display = 'block';
});

document.getElementById('btnCopierSauvegarde').addEventListener('click', async () => {
  const zoneTexte = document.getElementById('texteSauvegarde');
  try {
    await navigator.clipboard.writeText(zoneTexte.value);
    afficherStatut('Sauvegarde copiée ✓', 'ok');
  } catch (e) {
    // Certains navigateurs refusent le presse-papier : on sélectionne le texte
    // pour que tu puisses copier à la main.
    zoneTexte.select();
    afficherStatut('Texte sélectionné — copie-le à la main', 'erreur');
  }
});

document.getElementById('btnRestaurer').addEventListener('click', async () => {
  const texte = document.getElementById('texteRestauration').value.trim();
  if (!texte) { afficherStatut('Colle d\'abord un texte de sauvegarde', 'erreur'); return; }

  let importe;
  try {
    importe = JSON.parse(texte);
  } catch (e) {
    afficherStatut('Texte illisible : ce n\'est pas du JSON valide', 'erreur');
    return;
  }

  afficherStatut('Restauration en cours…', 'chargement');

  try {
    // --- Les jours ---
    const lignesJours = [];
    Object.keys(importe.days || {}).forEach(dateBrute => {
      const date = normaliserDate(dateBrute);
      if (!date) return;
      const source = importe.days[dateBrute] || {};
      lignesJours.push({
        date: date,
        kine_exo: !!source.kine_exo,
        sport: !!source.sport,
        kine_seance: !!source.kine_seance,
        regime: !!source.regime,
        velo: !!source.velo,
        douleur: (source.douleur === undefined || source.douleur === null) ? null : Number(source.douleur),
        douleur_note: source.douleur_note || null,
        eau: Number(source.eau) || 0
      });
    });
    if (lignesJours.length) {
      const { error } = await bdd.from('days').upsert(lignesJours, { onConflict: 'date' });
      if (error) throw error;
    }

    // --- Les pesées ---
    const lignesPoids = (importe.weights || [])
      .map(e => ({ date: normaliserDate(e.date), weight: Number(e.weight) }))
      .filter(e => e.date && !isNaN(e.weight));
    if (lignesPoids.length) {
      const { error } = await bdd.from('weights').upsert(lignesPoids, { onConflict: 'date' });
      if (error) throw error;
    }

    /* Rameur et tapis n'ont pas de contrainte d'unicité : réimporter
       créerait des doublons. On ne garde donc que les entrées absentes,
       en comparant sur (date + valeurs). */
    const signatureRameur = new Set(donnees.rameur.map(e => e.date + '|' + e.temps));
    const lignesRameur = (importe.rameur || [])
      .map(e => ({ date: normaliserDate(e.date), temps: e.temps }))
      .filter(e => e.date && e.temps && !signatureRameur.has(e.date + '|' + e.temps));
    if (lignesRameur.length) {
      const { error } = await bdd.from('rameur').insert(lignesRameur);
      if (error) throw error;
    }

    const signatureTapis = new Set(donnees.tapis.map(e => `${e.date}|${e.duree}|${e.vitesse}|${e.inclinaison}`));
    const lignesTapis = (importe.tapis || [])
      .map(e => ({
        date: normaliserDate(e.date),
        duree: e.duree === undefined || e.duree === null || e.duree === '' ? null : parseFloat(e.duree),
        vitesse: e.vitesse === undefined || e.vitesse === null || e.vitesse === '' || e.vitesse === '-' ? null : parseFloat(e.vitesse),
        inclinaison: e.inclinaison === undefined || e.inclinaison === null || e.inclinaison === '' ? null : parseFloat(e.inclinaison)
      }))
      .filter(e => e.date && !signatureTapis.has(`${e.date}|${e.duree}|${e.vitesse}|${e.inclinaison}`));
    if (lignesTapis.length) {
      const { error } = await bdd.from('tapis').insert(lignesTapis);
      if (error) throw error;
    }

    await chargerDonnees();
    toutAfficher();
    document.getElementById('texteRestauration').value = '';
    afficherStatut(`Restauré : ${lignesJours.length} jour(s), ${lignesPoids.length} pesée(s) ✓`, 'ok');
  } catch (erreur) {
    afficherStatut('Erreur de restauration : ' + (erreur.message || erreur), 'erreur');
  }
});


/* ============================================================
   15. CONNEXION / DÉCONNEXION
   ============================================================ */

async function demarrerAppli() {
  document.getElementById('ecranConnexion').style.display = 'none';
  document.getElementById('appli').style.display = 'block';

  // Les champs de date sont pré-remplis à aujourd'hui.
  document.getElementById('champDatePoids').value = aujourdhui();
  document.getElementById('champDateRameur').value = aujourdhui();
  document.getElementById('champDateTapis').value = aujourdhui();

  const charge = await chargerDonnees();
  if (charge) toutAfficher();
}

async function seConnecter() {
  const email = document.getElementById('champEmail').value.trim();
  const motDePasse = document.getElementById('champMotDePasse').value;
  const zoneErreur = document.getElementById('erreurConnexion');
  const bouton = document.getElementById('btnConnexion');

  if (!email || !motDePasse) {
    zoneErreur.textContent = 'Renseigne ton email et ton mot de passe.';
    return;
  }

  bouton.disabled = true;
  bouton.textContent = 'Connexion…';
  zoneErreur.textContent = '';

  try {
    const { error } = await bdd.auth.signInWithPassword({ email: email, password: motDePasse });
    if (error) {
      zoneErreur.textContent = 'Connexion refusée : vérifie ton email et ton mot de passe.';
      return;
    }
    document.getElementById('champMotDePasse').value = '';
    await demarrerAppli();
  } catch (e) {
    zoneErreur.textContent = 'Pas de connexion au serveur.';
  } finally {
    bouton.disabled = false;
    bouton.textContent = 'Se connecter';
  }
}

document.getElementById('btnConnexion').addEventListener('click', seConnecter);
document.getElementById('champMotDePasse').addEventListener('keydown', evenement => {
  if (evenement.key === 'Enter') seConnecter();
});

document.getElementById('btnDeconnexion').addEventListener('click', async () => {
  await bdd.auth.signOut();
  location.reload();
});


/* ============================================================
   16. DÉMARRAGE
   ============================================================
   Supabase garde la session dans le navigateur : tant qu'elle est valide,
   on entre directement dans l'application sans repasser par la connexion.
   ------------------------------------------------------------ */

(async function initialiser() {
  const { data } = await bdd.auth.getSession();
  if (data.session) {
    await demarrerAppli();
  }
  // Sinon, l'écran de connexion reste affiché.
})();
