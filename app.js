/* ============================================================
   SUIVI REMISE EN FORME — logique de l'application
   ============================================================
   La connexion à Supabase et la gestion des droits sont dans compte.js,
   chargé avant ce fichier. On y utilise notamment :
     · bdd          — le client Supabase
     · estLecteur   — vrai si le compte est en consultation seule
     · verrouille() — barrière posée devant chaque modification
   ------------------------------------------------------------ */


/* ============================================================
   1. ÉTAT DE L'APPLICATION
   ============================================================
   Toutes les données sont chargées une fois au démarrage, gardées en
   mémoire pour un affichage instantané, et réécrites dans Supabase à
   chaque modification.
   ------------------------------------------------------------ */

const DATE_DEBUT = '2026-08-17';   // premier jour du suivi
const RECORD_RAMEUR_INITIAL = '4:06'; // record à battre sur 1000 m
const OBJECTIF_EAU = 150;           // cl — soit trois gourdes de 50
/* Le même objectif, écrit pour être lu : « 1,5 L ». On le dérive de la
   constante plutôt que de le recopier, pour qu'aucun libellé ne mente le
   jour où l'objectif change encore. */
const OBJECTIF_EAU_TEXTE = (OBJECTIF_EAU / 100).toLocaleString('fr-FR') + ' L';

let donnees = {
  jours: {},    // { "2026-08-17": {kine_renfo, kine_mobilite, sport, kine_seance, regime, velo, douleur, douleur_note, eau} }
  poids: [],    // [{ id, date, weight }]
  rameur: [],   // [{ id, date, temps }]
  tapis: [],    // [{ id, date, duree, vitesse, inclinaison }]
  bonus: []     // [{ id, date, activite }] — le sport fait EN PLUS du minimum
};

// Les exercices kiné se font en deux temps : le renforcement et la mobilité.
// Ils se cochent séparément — une journée peut n'en compter qu'un des deux.
const ACTIVITES = ['kine_renfo', 'kine_mobilite', 'sport', 'kine_seance', 'regime', 'velo'];

let moisAffiche = new Date();
let jourSelectionne = null;


/* ============================================================
   2. OUTILS DE DATE
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
   3. BARRE DE STATUT (retour visuel de chaque enregistrement)
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
  if (verrouille()) return false;
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
   4. CHARGEMENT DES DONNÉES
   ============================================================ */

async function chargerDonnees() {
  afficherStatut('Chargement…', 'chargement');
  try {
    const [resJours, resPoids, resRameur, resTapis, resBonus] = await Promise.all([
      bdd.from('days').select('*'),
      bdd.from('weights').select('*').order('date', { ascending: true }),
      bdd.from('rameur').select('*').order('date', { ascending: false }),
      bdd.from('tapis').select('*').order('date', { ascending: false }),
      bdd.from('bonus').select('*').order('date', { ascending: false })
    ]);

    const erreur = resJours.error || resPoids.error || resRameur.error || resTapis.error || resBonus.error;
    if (erreur) {
      afficherStatut('Erreur de chargement : ' + erreur.message, 'erreur');
      return false;
    }

    donnees.jours = {};
    (resJours.data || []).forEach(ligne => { donnees.jours[ligne.date] = ligne; });
    donnees.poids  = resPoids.data  || [];
    donnees.rameur = resRameur.data || [];
    donnees.tapis  = resTapis.data  || [];
    donnees.bonus  = resBonus.data  || [];

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
  afficherResumePoids();
  afficherCourbePoids();
  afficherListePoids();
  afficherListeRameur();
  afficherListeTapis();
  afficherGrilleBonus();
  afficherBonusDuJour();
  afficherBilan();
}


/* ============================================================
   5. ENREGISTREMENT D'UN JOUR
   ============================================================
   La table days a "date" pour clé primaire : on envoie la ligne complète
   et Supabase remplace celle qui existe déjà (upsert).
   ------------------------------------------------------------ */

function jourEnMemoire(cle) {
  if (!donnees.jours[cle]) {
    donnees.jours[cle] = {
      date: cle,
      kine_renfo: false, kine_mobilite: false,
      sport: false, kine_seance: false,
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
    kine_renfo: !!jour.kine_renfo,
    kine_mobilite: !!jour.kine_mobilite,
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
   6. COMPTEUR DE JOURS
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
   7. JAUGES — des icônes qu'on appuie, plus de curseur
   ============================================================
   Un curseur se déplace tout seul quand le doigt le frôle en faisant
   défiler la page ; un appui, lui, est toujours volontaire. Chaque jauge
   est donc une rangée de crans : appuyer sur le n-ième donne la valeur n,
   et réappuyer sur le cran courant redescend à zéro — c'est la seule
   façon de revenir à « rien ».

   Un seul mécanisme, deux réglages :
     · douleur — dix crans de 1, teintés selon l'échelle du calendrier ;
     · eau     — quatre gourdes de 50 cl, l'objectif étant atteint à trois.

   Les icônes sont dessinées en SVG et non prises dans les émojis : un
   émoji impose ses propres couleurs, alors qu'il faut ici du bleu pour
   l'eau et le vert-jaune-rouge de la douleur.
   ------------------------------------------------------------ */

const PAS_EAU = 50;                             // cl par gourde
/* Quatre gourdes, alors que l'objectif en vaut trois : on peut boire
   au-delà, et la quatrième est là pour ça. Le maximum, 200 cl, est celui
   qu'accepte la contrainte de la base. */
const NB_GOURDES = 4;

// Le repère sous la jauge annonce l'objectif sans le recopier à la main.
document.getElementById('objectifEau').textContent = `Objectif ${OBJECTIF_EAU_TEXTE}`;

// Une gourde : un bouchon posé sur un corps arrondi. Elle se colore
// entièrement par currentColor, donc depuis la feuille de styles.
const DESSIN_GOURDE = `
    <svg viewBox="0 0 24 40" aria-hidden="true">
      <rect x="9" y="0" width="6" height="7" rx="1.5"/>
      <rect x="4" y="7" width="16" height="32" rx="6"/>
    </svg>`;

function dessinerJaugeDouleur(conteneur, valeur) {
  const teinte = couleurDouleur(valeur);   // la même que la barre du calendrier
  conteneur.innerHTML = Array.from({ length: 10 }, (_, index) => {
    const cran = index + 1;
    const allume = cran <= valeur;
    const fond = allume ? ` style="background:${teinte}; border-color:${teinte}"` : '';
    return `<button class="cran${allume ? ' allume' : ''}" data-cran="${cran}"${fond}>${cran}</button>`;
  }).join('');
}

function dessinerJaugeEau(conteneur, valeur) {
  conteneur.innerHTML = Array.from({ length: NB_GOURDES }, (_, index) => {
    const cran = index + 1;
    const allume = cran * PAS_EAU <= valeur;
    return `<button class="gourde${allume ? ' allume' : ''}" data-cran="${cran}">${DESSIN_GOURDE}</button>`;
  }).join('');
}

/* Traduit un appui en valeur. Renvoie null si l'appui n'a pas atterri sur
   un cran — un doigt posé entre deux icônes ne doit rien changer. */
function valeurChoisie(evenement, valeurActuelle, pas) {
  const cran = evenement.target.closest('[data-cran]');
  if (!cran) return null;
  const valeur = Number(cran.dataset.cran) * pas;
  return (valeur === valeurActuelle) ? 0 : valeur;
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

  /* La grille court du lundi de la semaine du 1er au dimanche de la
     semaine du dernier jour. Les cases qui dépassent sont remplies par
     les mois voisins plutôt que laissées vides : une première ligne à
     deux cases et une dernière à une seule donnaient une grille bancale.
     getDay() renvoie 0 le dimanche, d'où les décalages. */
  const premier = new Date(annee, mois, 1);
  let decalage = premier.getDay() - 1;
  if (decalage < 0) decalage = 6;

  const dernier = new Date(annee, mois + 1, 0);
  const finSemaine = dernier.getDay() === 0 ? 0 : 7 - dernier.getDay();

  const debutGrille = new Date(annee, mois, 1 - decalage);
  const finGrille = new Date(annee, mois + 1, finSemaine);

  const cleAujourdhui = aujourdhui();
  const joursAvecBonus = datesAvecBonus();   // calculé une fois pour toute la grille

  const curseur = new Date(debutGrille);
  while (curseur <= finGrille) {
    const dateObjet = new Date(curseur);     // figée : le curseur, lui, avance
    curseur.setDate(curseur.getDate() + 1);

    const cle = cleDate(dateObjet);
    const numero = dateObjet.getDate();
    const horsMois = dateObjet.getMonth() !== mois;
    const jour = donnees.jours[cle] || {};

    // Une journée où au moins une case est cochée se teinte : c'est ce qui
    // doit sauter aux yeux quand on ouvre le calendrier. Un sport bonus
    // compte tout autant — c'est une séance de plus.
    const bonusCeJour = joursAvecBonus.has(cle);
    const aTenu = bonusCeJour || ACTIVITES.some(activite => jour[activite]);

    const case_ = document.createElement('div');
    case_.className = 'cal-day'
      + (horsMois ? ' hors-mois' : '')
      + (aTenu ? ' rempli' : '')
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

    /* Six pastilles issues de la boucle, puis une septième ajoutée à part :
       le bonus ne vit pas dans la ligne du jour mais dans sa propre table,
       il n'a donc pas de colonne à lire ici. Une seule pastille pour tous
       les sports bonus — le détail se lit dans le Bilan. */
    const pastilles = ACTIVITES
      .map(cleActivite => `<span class="dot ${jour[cleActivite] ? 'on ' + cleActivite : ''}"></span>`)
      .join('')
      + `<span class="dot ${bonusCeJour ? 'on bonus' : ''}"></span>`;

    case_.innerHTML = `${drapeau}<span class="num">${numero}</span><div class="dots">${pastilles}</div>${barreDouleur}`;
    // Cliquer un jour voisin bascule d'abord sur son mois : sélectionner
    // une case qu'on ne verrait plus n'aurait aucun sens.
    case_.addEventListener('click', () => {
      if (horsMois) moisAffiche = new Date(dateObjet.getFullYear(), dateObjet.getMonth(), 1);
      ouvrirPanneauJour(cle);
    });
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

  document.getElementById('noteDouleurPanneau').value = jour.douleur_note || '';
  rafraichirDouleurPanneau();

  afficherCalendrier();  // pour surligner la case sélectionnée
  panneau.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* Redessine la seule douleur du panneau, sans toucher au reste : appuyer
   sur un cran ne doit ni refaire défiler la page, ni écraser la note en
   cours de frappe. */
function rafraichirDouleurPanneau() {
  const jour = donnees.jours[jourSelectionne] || {};
  const renseignee = jour.douleur !== null && jour.douleur !== undefined;
  document.getElementById('valeurDouleurPanneau').textContent = renseignee ? jour.douleur : '–';
  dessinerJaugeDouleur(document.getElementById('jaugeDouleurPanneau'), renseignee ? jour.douleur : 0);
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

// La douleur du panneau : un appui sur un cran enregistre aussitôt.
document.getElementById('jaugeDouleurPanneau').addEventListener('click', async evenement => {
  if (!jourSelectionne || verrouille()) return;
  const jour = jourEnMemoire(jourSelectionne);
  const choix = valeurChoisie(evenement, jour.douleur, 1);
  if (choix === null) return;

  jour.douleur = choix;
  rafraichirDouleurPanneau();
  await sauvegarderJour(jourSelectionne, 'Douleur enregistrée ✓');
  afficherCalendrier();
  afficherBilan();
  if (jourSelectionne === aujourdhui()) afficherAujourdhui();
});

/* La note part en base quand tu quittes le champ. Un champ texte ne bouge
   pas tout seul quand on fait défiler : pas besoin de bouton ici. */
document.getElementById('noteDouleurPanneau').addEventListener('change', async () => {
  if (!jourSelectionne || verrouille()) return;
  const jour = jourEnMemoire(jourSelectionne);
  jour.douleur_note = document.getElementById('noteDouleurPanneau').value.trim() || null;
  await sauvegarderJour(jourSelectionne, 'Note enregistrée ✓');
  afficherBilan();
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
  document.getElementById('valeurDouleurJour').textContent = douleurRenseignee ? jour.douleur : '–';
  dessinerJaugeDouleur(document.getElementById('jaugeDouleurJour'), douleurRenseignee ? jour.douleur : 0);

  // On ne réécrit pas la note pendant que tu la tapes.
  const champNote = document.getElementById('noteDouleurJour');
  if (document.activeElement !== champNote) champNote.value = jour.douleur_note || '';

  const eau = jour.eau || 0;
  document.getElementById('valeurEau').textContent = `${eau} cl`;
  dessinerJaugeEau(document.getElementById('jaugeEau'), eau);
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

// La douleur du jour : un appui sur un cran enregistre aussitôt.
document.getElementById('jaugeDouleurJour').addEventListener('click', async evenement => {
  if (verrouille()) return;
  const jour = jourEnMemoire(aujourdhui());
  const choix = valeurChoisie(evenement, jour.douleur, 1);
  if (choix === null) return;

  jour.douleur = choix;
  afficherAujourdhui();
  await sauvegarderJour(aujourdhui(), 'Douleur enregistrée ✓');
  afficherCalendrier();
  afficherBilan();
});

document.getElementById('noteDouleurJour').addEventListener('change', async () => {
  if (verrouille()) return;
  const jour = jourEnMemoire(aujourdhui());
  jour.douleur_note = document.getElementById('noteDouleurJour').value.trim() || null;
  await sauvegarderJour(aujourdhui(), 'Note enregistrée ✓');
  afficherBilan();
});

// L'eau : une gourde vidée, un appui.
document.getElementById('jaugeEau').addEventListener('click', async evenement => {
  if (verrouille()) return;
  const jour = jourEnMemoire(aujourdhui());
  const choix = valeurChoisie(evenement, jour.eau || 0, PAS_EAU);
  if (choix === null) return;

  jour.eau = choix;
  afficherAujourdhui();
  const message = jour.eau >= OBJECTIF_EAU ? `Objectif ${OBJECTIF_EAU_TEXTE} atteint ✓` : 'Eau enregistrée ✓';
  await sauvegarderJour(aujourdhui(), message);
  afficherBilan();
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
  const nbRenfo = listeJours.filter(jour => jour.kine_renfo).length;
  const nbMobilite = listeJours.filter(jour => jour.kine_mobilite).length;

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
    { icone: '💪', libelle: '10 renforcements',   obtenu: nbRenfo >= 10 },
    { icone: '🤸', libelle: '10 mobilités',       obtenu: nbMobilite >= 10 },
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
  afficherResumePoids();
  afficherCourbePoids();
  afficherListePoids();
  afficherBadges();
});

/* Le chiffre qui compte vraiment : ce qui a été perdu depuis la première
   pesée. La courbe montre le chemin, ce bandeau montre l'arrivée.

   On compare la première pesée enregistrée à la dernière, et non à un
   poids de départ écrit en dur : le jour où tu corriges une vieille
   pesée, le total suit tout seul. */
function afficherResumePoids() {
  const zone = document.getElementById('resumePoids');
  const points = [...donnees.poids]
    .filter(entree => entree.weight !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Une seule pesée ne dit rien d'une évolution : on n'affiche rien.
  if (points.length < 2) { zone.innerHTML = ''; return; }

  const depart = Number(points[0].weight);
  const actuel = Number(points[points.length - 1].weight);
  const ecart = actuel - depart;
  const enBaisse = ecart < 0;

  const chiffre = (Math.abs(ecart) < 0.05)
    ? 'stable'
    : `${enBaisse ? '−' : '+'}${Math.abs(ecart).toFixed(1).replace('.', ',')} kg`;

  zone.innerHTML = `
    <div class="resume-poids${enBaisse ? ' mieux' : ''}">
      <div>
        <div class="libelle">Depuis la première pesée</div>
        <div class="detail">${depart.toFixed(1).replace('.', ',')} → ${actuel.toFixed(1).replace('.', ',')} kg · depuis le ${dateCourte(points[0].date)}</div>
      </div>
      <div class="chiffre">${chiffre}</div>
    </div>`;
}

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
      <button class="btn-suppr ecriture" data-table="weights" data-date="${entree.date}">✕</button>
    </div>`).join('');
}


/* ============================================================
   12. RAMEUR ET TAPIS
   ============================================================ */

/* Ramène une saisie libre au format "m:ss" attendu par la base.

   Les deux-points obligent à changer de clavier sur téléphone : on accepte
   donc le point et la virgule, ainsi que la saisie sans séparateur du tout.
   Toutes ces écritures donnent 4:06 — "4:06", "4.06", "4,06", "4.6", "406".

   Renvoie null si la saisie ne veut rien dire. */
function normaliserTempsRameur(saisie) {
  const nettoye = String(saisie).trim().replace(/\s/g, '').replace(/[.,]/g, ':');

  let minutes, secondes;
  if (nettoye.indexOf(':') !== -1) {
    const morceaux = nettoye.split(':');
    if (morceaux.length !== 2) return null;
    minutes = morceaux[0];
    secondes = morceaux[1];
  } else if (/^\d{3,4}$/.test(nettoye)) {
    // "406" ou "1230" : les deux derniers chiffres sont les secondes.
    minutes = nettoye.slice(0, nettoye.length - 2);
    secondes = nettoye.slice(-2);
  } else {
    return null;
  }

  if (!/^\d{1,2}$/.test(minutes) || !/^\d{1,2}$/.test(secondes)) return null;
  // "4.6" : on comprend 6 secondes, pas 60.
  if (secondes.length === 1) secondes = '0' + secondes;
  if (Number(secondes) > 59) return null;

  return Number(minutes) + ':' + secondes;
}

document.getElementById('btnAjouterRameur').addEventListener('click', async () => {
  if (verrouille()) return;
  const date = document.getElementById('champDateRameur').value;
  const champTemps = document.getElementById('champTempsRameur');
  const temps = normaliserTempsRameur(champTemps.value);

  if (!date) { afficherStatut('Choisis une date', 'erreur'); return; }
  if (!temps) {
    afficherStatut('Temps illisible — écris par exemple 4.06', 'erreur');
    return;
  }
  // On réaffiche le temps compris, pour que la conversion soit visible.
  champTemps.value = temps;

  const { data, error } = await bdd.from('rameur').insert({ date: date, temps: temps }).select();
  if (error) { afficherStatut('Erreur : ' + error.message, 'erreur'); return; }

  donnees.rameur.push(data[0]);
  champTemps.value = '';
  afficherStatut(`Perf rameur ${temps} ajoutée ✓`, 'ok');
  afficherListeRameur();
  afficherBadges();
});

document.getElementById('btnAjouterTapis').addEventListener('click', async () => {
  if (verrouille()) return;
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
      <button class="btn-suppr ecriture" data-table="rameur" data-id="${entree.id}">✕</button>
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
        <button class="btn-suppr ecriture" data-table="tapis" data-id="${entree.id}">✕</button>
      </div>`;
  }).join('');
}


/* ============================================================
   13. SPORT BONUS
   ============================================================
   Le minimum hebdomadaire vit dans la table "days", une colonne par
   activité. Le bonus, lui, a sa propre table : une ligne par séance
   faite. C'est cette forme — et elle seule — qui permet d'en noter
   plusieurs le même jour et de répondre à « combien de foot ce mois-ci ».

   La liste ci-dessous ne sert qu'à dessiner les boutons. La table, elle,
   accepte n'importe quel libellé : « Autre » enregistre ce que tu tapes,
   et ajouter un sport ici ne demandera jamais de migration.
   ------------------------------------------------------------ */

const SPORTS_BONUS = [
  { cle: 'foot',        icone: '⚽',  libelle: 'Foot' },
  { cle: 'basket',      icone: '🏀', libelle: 'Basket' },
  { cle: 'rando',       icone: '🥾', libelle: 'Rando' },
  { cle: 'salle libre', icone: '🏃', libelle: 'Salle<br>libre' },
  { cle: 'vélo',        icone: '🚴', libelle: 'Vélo' },
  { cle: 'autre',       icone: '➕', libelle: 'Autre' }
];

/* Une seule écriture par sport : « Escalade », « escalade » et
   « ESCALADE  » doivent compter ensemble dans le Bilan. */
function normaliserBonus(texte) {
  return texte.trim().toLowerCase().replace(/\s+/g, ' ');
}

function libelleBonus(activite) {
  return activite.charAt(0).toUpperCase() + activite.slice(1);
}

// Les dates ayant au moins un bonus — le calendrier s'en sert pour sa
// septième pastille, et pour teinter la journée comme les autres.
function datesAvecBonus() {
  return new Set(donnees.bonus.map(entree => entree.date));
}

function afficherGrilleBonus() {
  document.getElementById('grilleBonus').innerHTML = SPORTS_BONUS.map(sport => `
    <div class="today-btn" data-bonus="${sport.cle}">
      <span class="icon">${sport.icone}</span>
      <span class="label">${sport.libelle}</span>
    </div>`).join('');
}

function afficherBonusDuJour() {
  const zone = document.getElementById('listeBonusDuJour');
  const duJour = donnees.bonus.filter(entree => entree.date === aujourdhui());

  if (duJour.length === 0) {
    zone.innerHTML = '<div class="empty-msg">Rien en plus aujourd\'hui.</div>';
    return;
  }
  // La liste du jour rend une fausse manœuvre visible et réparable.
  zone.innerHTML = duJour.map(entree => `
    <div class="perf-entry">
      <span class="perf-val">⭐ ${libelleBonus(entree.activite)}</span>
      <button class="btn-suppr ecriture" data-table="bonus" data-id="${entree.id}">✕</button>
    </div>`).join('');
}

async function ajouterBonus(activiteBrute) {
  if (verrouille()) return;
  const activite = normaliserBonus(activiteBrute);
  if (!activite) { afficherStatut('Écris le nom du sport', 'erreur'); return; }

  const { data, error } = await bdd.from('bonus')
    .insert({ date: aujourdhui(), activite: activite }).select();
  if (error) { afficherStatut('Erreur : ' + error.message, 'erreur'); return; }

  donnees.bonus.push(data[0]);
  afficherStatut(`${libelleBonus(activite)} ajouté ✓`, 'ok');
  afficherBonusDuJour();
  afficherCalendrier();
  afficherBilan();
}

// Les boutons. « Autre » n'enregistre rien : il ouvre le champ de saisie.
document.getElementById('grilleBonus').addEventListener('click', evenement => {
  const bouton = evenement.target.closest('[data-bonus]');
  if (!bouton) return;

  const zoneAutre = document.getElementById('zoneBonusAutre');
  if (bouton.dataset.bonus === 'autre') {
    zoneAutre.style.display = 'block';
    document.getElementById('champBonusAutre').focus();
    return;
  }
  zoneAutre.style.display = 'none';
  ajouterBonus(bouton.dataset.bonus);
});

document.getElementById('btnBonusAutre').addEventListener('click', async () => {
  const champ = document.getElementById('champBonusAutre');
  await ajouterBonus(champ.value);
  champ.value = '';
  document.getElementById('zoneBonusAutre').style.display = 'none';
});


/* ============================================================
   14. SUPPRESSION D'UNE LIGNE
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
    afficherResumePoids();
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
    } else if (table === 'bonus') {
      donnees.bonus = donnees.bonus.filter(entree => entree.id !== id);
      afficherBonusDuJour();
      afficherCalendrier();
      afficherBilan();
    } else {
      donnees.tapis = donnees.tapis.filter(entree => entree.id !== id);
      afficherListeTapis();
    }
  }
});


/* ============================================================
   15. SAUVEGARDE : EXPORT ET IMPORT JSON
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
  if (verrouille()) return;
  const zoneTexte = document.getElementById('texteSauvegarde');
  zoneTexte.value = JSON.stringify(construireExport(), null, 2);
  zoneTexte.style.display = 'block';
  document.getElementById('btnCopierSauvegarde').style.display = 'block';
});

document.getElementById('btnCopierSauvegarde').addEventListener('click', async () => {
  if (verrouille()) return;
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
  if (verrouille()) return;
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
        // Les sauvegardes d'avant la distinction renfo / mobilité portent
        // "kine_exo" : tout ce qu'elles contiennent est du renforcement.
        kine_renfo: !!(source.kine_renfo || source.kine_exo),
        kine_mobilite: !!source.kine_mobilite,
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
      .map(e => ({ date: normaliserDate(e.date), temps: normaliserTempsRameur(e.temps) }))
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
   16. BILAN — statistiques par semaine ou par mois
   ============================================================
   Tout est recalculé à partir de donnees.jours et donnees.poids, déjà
   chargés en mémoire : aucune requête supplémentaire.

   Deux principes de calcul, qui expliquent la plupart des choix ici :

   · On ne juge jamais une période sur des jours à venir. La semaine en
     cours est évaluée sur les jours écoulés, sinon toutes les moyennes
     s'effondreraient artificiellement un lundi matin.

   · La couleur d'une tendance dit « mieux » ou « moins bien », jamais le
     sens de la variation : une douleur qui baisse est une bonne nouvelle,
     un nombre de séances qui baisse ne l'est pas.
   ------------------------------------------------------------ */

let typePeriodeBilan = 'semaine';   // 'semaine' ou 'mois'
let dateReferenceBilan = new Date(); // un jour quelconque de la période affichée

/* Bornes de la période contenant `dateObjet`, en clés ISO.
   La semaine va du lundi au dimanche, comme le calendrier. */
function bornesPeriode(dateObjet, type) {
  if (type === 'mois') {
    const annee = dateObjet.getFullYear(), mois = dateObjet.getMonth();
    return {
      debut: cleDate(new Date(annee, mois, 1)),
      fin:   cleDate(new Date(annee, mois + 1, 0))
    };
  }
  // getDay() renvoie 0 le dimanche : on recule jusqu'au lundi.
  let decalage = dateObjet.getDay() - 1;
  if (decalage < 0) decalage = 6;
  const lundi = new Date(dateObjet);
  lundi.setDate(lundi.getDate() - decalage);
  const dimanche = new Date(lundi);
  dimanche.setDate(dimanche.getDate() + 6);
  return { debut: cleDate(lundi), fin: cleDate(dimanche) };
}

// Toutes les clés de date entre deux bornes incluses.
function clesEntre(cleDebut, cleFin) {
  const cles = [];
  const curseur = versDate(cleDebut);
  const fin = versDate(cleFin);
  while (curseur <= fin) {
    cles.push(cleDate(curseur));
    curseur.setDate(curseur.getDate() + 1);
  }
  return cles;
}

// Dernière pesée connue à cette date ou avant.
function poidsALaDate(cle) {
  const anterieures = donnees.poids
    .filter(entree => entree.date <= cle)
    .sort((a, b) => a.date.localeCompare(b.date));
  return anterieures.length ? anterieures[anterieures.length - 1] : null;
}

/* Douleur d'un jour donné. Un jour sans saisie vaut 0 : le curseur part de
   zéro et n'est enregistré que lorsqu'il y a quelque chose à signaler, donc
   l'absence de note veut dire « pas eu mal », pas « on ne sait pas ». */
function douleurDuJour(cle) {
  const jour = donnees.jours[cle];
  if (!jour || jour.douleur === null || jour.douleur === undefined) return 0;
  return Number(jour.douleur);
}

// Moyenne de douleur sur une plage — sert aussi à comparer deux périodes.
function douleurMoyenneSur(cleDebut, cleFin) {
  const cles = clesEntre(cleDebut, cleFin);
  if (!cles.length) return null;
  return cles.reduce((total, cle) => total + douleurDuJour(cle), 0) / cles.length;
}

/* Calcule toutes les statistiques d'une période.
   Renvoie null si la période est entièrement dans le futur. */
function calculerBilan(cleDebut, cleFin) {
  const cleAujourdhui = aujourdhui();
  const finReelle = cleFin > cleAujourdhui ? cleAujourdhui : cleFin;
  if (finReelle < cleDebut) return null;

  const cles = clesEntre(cleDebut, finReelle);
  const joursConnus = cles.map(cle => donnees.jours[cle]).filter(Boolean);

  // --- Séances par activité ---
  const seances = {};
  ACTIVITES.forEach(activite => {
    seances[activite] = joursConnus.filter(jour => jour[activite]).length;
  });

  /* --- Sport bonus ---
     Regroupé par sport, avec les dates : le calendrier dit qu'il y a eu
     quelque chose en plus, c'est ici qu'on lit quoi et quand. */
  const bonusPeriode = donnees.bonus
    .filter(entree => entree.date >= cleDebut && entree.date <= finReelle)
    .sort((a, b) => a.date.localeCompare(b.date));

  const bonusParSport = {};
  bonusPeriode.forEach(entree => {
    if (!bonusParSport[entree.activite]) bonusParSport[entree.activite] = [];
    bonusParSport[entree.activite].push(entree.date);
  });

  // --- Douleur ---
  // Tous les jours de la période comptent, ceux sans saisie valant 0.
  const releves = cles.map(cle => ({ cle: cle, valeur: douleurDuJour(cle) }));
  const moyenne = releves.reduce((total, e) => total + e.valeur, 0) / releves.length;
  const plusHaut = releves.reduce((a, b) => (b.valeur > a.valeur ? b : a));
  const joursNotes = releves.filter(e => e.valeur > 0).length;

  const douleur = {
    moyenne: moyenne,
    max: plusHaut.valeur,
    dateMax: plusHaut.cle,
    joursNotes: joursNotes   // jours où une douleur a réellement été ressentie
  };

  // Comparaison avec la période précédente — omise si elle n'a aucun relevé.
  const veille = versDate(cleDebut);
  veille.setDate(veille.getDate() - 1);
  const precedente = bornesPeriode(veille, typePeriodeBilan);
  // Comparaison omise si la période précédente est antérieure au suivi.
  const moyennePrecedente = (precedente.fin < DATE_DEBUT)
    ? null
    : douleurMoyenneSur(precedente.debut, precedente.fin);
  const ecartDouleur = (moyennePrecedente !== null)
    ? douleur.moyenne - moyennePrecedente
    : null;

  // --- Poids ---
  let depart = poidsALaDate(cleDebut);
  if (!depart) {
    // Aucune pesée avant la période : on prend la première qu'elle contient.
    const dedans = donnees.poids
      .filter(e => e.date >= cleDebut && e.date <= finReelle)
      .sort((a, b) => a.date.localeCompare(b.date));
    depart = dedans.length ? dedans[0] : null;
  }
  const arrivee = poidsALaDate(finReelle);
  // Même pesée aux deux bouts : il n'y a pas eu de nouvelle mesure.
  const memeMesure = depart && arrivee && depart.date === arrivee.date;
  const poids = arrivee ? {
    depart: depart ? Number(depart.weight) : null,
    arrivee: Number(arrivee.weight),
    ecart: (depart && !memeMesure) ? Number(arrivee.weight) - Number(depart.weight) : null,
    nouvelleMesure: !memeMesure
  } : null;

  // --- Eau ---
  // Moyenne rapportée aux jours écoulés, pas aux seuls jours renseignés :
  // un jour sans saisie est un jour où l'objectif n'a pas été suivi.
  const totalEau = joursConnus.reduce((total, jour) => total + (Number(jour.eau) || 0), 0);
  const joursAvecEau = joursConnus.filter(jour => Number(jour.eau) > 0).length;

  // --- Notes écrites sur la période ---
  const notes = cles
    .map(cle => ({ cle: cle, jour: donnees.jours[cle] }))
    .filter(e => e.jour && e.jour.douleur_note && e.jour.douleur_note.trim())
    .map(e => ({
      date: e.cle,
      douleur: douleurDuJour(e.cle),
      texte: e.jour.douleur_note.trim()
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    debut: cleDebut,
    fin: cleFin,
    finReelle: finReelle,
    nbJours: cles.length,
    periodeEnCours: cleFin > cleAujourdhui,
    aDesDonnees: joursConnus.length > 0 || arrivee !== null,
    seances: seances,
    bonus: bonusParSport,
    nbBonus: bonusPeriode.length,
    /* Les séances physiques. La séance chez le kiné en fait partie : c'est
       un vrai travail, et une cause fréquente de douleur. Le sport bonus
       aussi — c'est une séance de plus, pas un doublon du minimum. */
    totalSportif: seances.kine_renfo + seances.kine_mobilite + seances.sport
                + seances.velo + seances.kine_seance + bonusPeriode.length,
    notes: notes,
    regime: joursConnus.filter(jour => jour.regime).length,
    douleur: douleur,
    ecartDouleur: ecartDouleur,
    poids: poids,
    eauMoyenne: cles.length ? totalEau / cles.length : 0,
    joursAvecEau: joursAvecEau
  };
}

// "Semaine du 11 au 17 août 2026" ou "Août 2026"
function libellePeriode(cleDebut, cleFin, type) {
  if (type === 'mois') {
    const texte = versDate(cleDebut).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    return texte.charAt(0).toUpperCase() + texte.slice(1);
  }
  const d = versDate(cleDebut), f = versDate(cleFin);
  const memeMois = d.getMonth() === f.getMonth();
  const debutTexte = d.toLocaleDateString('fr-FR', memeMois ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
  const finTexte = f.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  return `Semaine du ${debutTexte} au ${finTexte}`;
}

// Une variation, avec la couleur qui dit si c'est une bonne nouvelle.
function tendance(ecart, baisseEstBonne, suffixe) {
  // Pas de période précédente à comparer : on n'affiche rien plutôt que
  // « stable », qui laisserait croire à une comparaison réelle.
  if (ecart === null) return '';
  if (Math.abs(ecart) < 0.05) {
    return '<div class="bilan-tendance stable">stable</div>';
  }
  const fleche = ecart < 0 ? '↓' : '↑';
  const bonne = ecart < 0 ? baisseEstBonne : !baisseEstBonne;
  const valeur = Math.abs(ecart).toFixed(1).replace('.', ',');
  return `<div class="bilan-tendance ${bonne ? 'mieux' : 'moins'}">${fleche} ${valeur} ${suffixe}</div>`;
}

/* Liste des notes écrites sur la période.

   Au-delà de six, on replie : un mois chargé produirait deux ou trois
   écrans de notes, qui repousseraient les statistiques hors de vue.
   On utilise <details>, replié par défaut — aucun JavaScript nécessaire,
   et le navigateur gère l'ouverture. */
/* La ligne « Sport bonus » du Bilan. Repliée, elle ne montre que le
   total ; dépliée, elle dit quel sport et quand — c'est la contrepartie
   de la pastille unique du calendrier, qui ne peut pas porter le détail.

   Comme pour les notes, c'est une balise <details> : le navigateur gère
   l'ouverture, aucun JavaScript n'est nécessaire. */
function ligneBonus(bilan) {
  if (bilan.nbBonus === 0) return '';

  const sports = Object.keys(bilan.bonus).sort((a, b) =>
    bilan.bonus[b].length - bilan.bonus[a].length || a.localeCompare(b));

  const detail = sports.map(sport => `
    <div class="bilan-bonus-sport">
      <span class="nom">${libelleBonus(sport)} · ${bilan.bonus[sport].length}</span>
      <span class="quand">${bilan.bonus[sport].map(dateCourte).join(' · ')}</span>
    </div>`).join('');

  return `
    <details class="bilan-bonus">
      <summary>
        <span class="titre">⭐ Sport bonus</span>
        <span class="compte">${bilan.nbBonus}</span>
      </summary>
      ${detail}
    </details>`;
}

const SEUIL_NOTES_REPLIEES = 6;

function listeNotes(notes) {
  const lignes = notes.map(note => `
    <div class="bilan-note">
      <span class="pastille" style="background:${couleurDouleur(note.douleur)}"></span>
      <div>
        <div class="bilan-note-entete">${versDate(note.date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} · douleur ${note.douleur}</div>
        <div class="bilan-note-texte">${note.texte.replace(/</g, '&lt;')}</div>
      </div>
    </div>`).join('');

  if (notes.length <= SEUIL_NOTES_REPLIEES) {
    return `<div class="bilan-titre-tuile">Notes de la période</div>${lignes}`;
  }

  return `
    <details class="bilan-notes-repliees">
      <summary>
        <span class="bilan-titre-tuile">Notes de la période</span>
        <span class="bilan-compte-notes">${notes.length} notes</span>
      </summary>
      ${lignes}
    </details>`;
}

function afficherBilan() {
  const bornes = bornesPeriode(dateReferenceBilan, typePeriodeBilan);
  document.getElementById('libelleBilan').textContent =
    libellePeriode(bornes.debut, bornes.fin, typePeriodeBilan);

  // On ne navigue ni avant le début du suivi, ni au-delà de la période en cours.
  const cleAujourdhui = aujourdhui();
  document.getElementById('btnBilanPrecedent').disabled = bornes.debut <= DATE_DEBUT;
  document.getElementById('btnBilanSuivant').disabled = bornes.fin >= cleAujourdhui;

  const zone = document.getElementById('contenuBilan');
  const bilan = calculerBilan(bornes.debut, bornes.fin);

  if (!bilan || !bilan.aDesDonnees) {
    zone.innerHTML = '<div class="empty-msg">Pas encore de données pour cette période.</div>';
    return;
  }

  const nomsActivites = {
    kine_renfo: '💪 Kiné renforcement',
    kine_mobilite: '🤸 Kiné mobilité',
    sport: '🏋️ Sport salle',
    kine_seance: '🧑‍⚕️ Séance kiné',
    velo: '🚴 Vélo'
  };
  const lignesSeances = Object.keys(nomsActivites).map(cle => `
    <div class="bilan-ligne">
      <span>${nomsActivites[cle]}</span>
      <span class="compte">${bilan.seances[cle]}</span>
    </div>`).join('')
    + ligneBonus(bilan);

  // --- Douleur ---
  const detailDouleur = bilan.douleur.joursNotes === 0
    ? 'aucune douleur signalée'
    : `pic à ${bilan.douleur.max} le ${dateCourte(bilan.douleur.dateMax)} · ${bilan.douleur.joursNotes} jour${bilan.douleur.joursNotes > 1 ? 's' : ''} avec douleur`;

  const tuileDouleur = `
    <div class="bilan-tuile">
      <div class="bilan-chiffre">${bilan.douleur.moyenne.toFixed(1).replace('.', ',')}<span class="unite"> /10</span></div>
      <div class="bilan-libelle">Douleur moyenne</div>
      ${tendance(bilan.ecartDouleur, true, 'pt')}
      <div class="bilan-detail">${detailDouleur}</div>
    </div>`;

  // --- Poids ---
  let tuilePoids;
  if (bilan.poids && bilan.poids.ecart !== null) {
    const signe = bilan.poids.ecart > 0 ? '+' : '−';
    const valeur = Math.abs(bilan.poids.ecart).toFixed(1).replace('.', ',');
    const bonne = bilan.poids.ecart < 0;
    tuilePoids = `
      <div class="bilan-tuile">
        <div class="bilan-chiffre" style="color:${bonne ? 'var(--sage-deep)' : 'var(--ink)'}">${signe}${valeur}<span class="unite"> kg</span></div>
        <div class="bilan-libelle">Variation de poids</div>
        <div class="bilan-detail">
          ${bilan.poids.depart.toFixed(1).replace('.', ',')} → ${bilan.poids.arrivee.toFixed(1).replace('.', ',')} kg
        </div>
      </div>`;
  } else if (bilan.poids) {
    tuilePoids = `
      <div class="bilan-tuile">
        <div class="bilan-chiffre">${bilan.poids.arrivee.toFixed(1).replace('.', ',')}<span class="unite"> kg</span></div>
        <div class="bilan-libelle">Dernier poids connu</div>
        <div class="bilan-detail">pas de nouvelle pesée sur la période</div>
      </div>`;
  } else {
    tuilePoids = `
      <div class="bilan-tuile">
        <div class="bilan-chiffre">–</div>
        <div class="bilan-libelle">Poids</div>
        <div class="bilan-detail">aucune pesée enregistrée</div>
      </div>`;
  }

  const pourcentEau = Math.round((bilan.eauMoyenne / OBJECTIF_EAU) * 100);

  zone.innerHTML = `
    <div class="bilan-grille">
      ${tuileDouleur}
      ${tuilePoids}

      <div class="bilan-tuile">
        <div class="bilan-chiffre">${bilan.regime}<span class="unite"> / ${bilan.nbJours}</span></div>
        <div class="bilan-libelle">Jours sans écart</div>
        <div class="bilan-detail">${Math.round((bilan.regime / bilan.nbJours) * 100)} % de la période</div>
      </div>

      <div class="bilan-tuile">
        <div class="bilan-chiffre">${Math.round(bilan.eauMoyenne)}<span class="unite"> cl/j</span></div>
        <div class="bilan-libelle">Eau bue en moyenne</div>
        <div class="bilan-detail">${pourcentEau} % de l'objectif · noté ${bilan.joursAvecEau} j sur ${bilan.nbJours}</div>
      </div>

      <div class="bilan-tuile pleine">
        <div class="bilan-titre-tuile">Séances</div>
        <div class="bilan-total">
          <span class="bilan-chiffre">${bilan.totalSportif}</span>
          <span class="bilan-total-texte">séance${bilan.totalSportif > 1 ? 's' : ''} cette ${typePeriodeBilan === 'mois' ? 'période' : 'semaine'}</span>
        </div>
        ${lignesSeances}
      </div>

      ${bilan.notes.length ? `
      <div class="bilan-tuile pleine">
        ${listeNotes(bilan.notes)}
      </div>` : ''}
    </div>
    ${bilan.periodeEnCours
      ? `<div class="bilan-detail" style="text-align:center; margin-top:10px;">Période en cours — calculé sur ${bilan.nbJours} jour${bilan.nbJours > 1 ? 's' : ''} écoulé${bilan.nbJours > 1 ? 's' : ''}.</div>`
      : ''}
  `;
}

// Navigue d'une période vers l'arrière (-1) ou vers l'avant (+1).
function changerPeriodeBilan(direction) {
  if (typePeriodeBilan === 'mois') {
    dateReferenceBilan.setMonth(dateReferenceBilan.getMonth() + direction);
  } else {
    dateReferenceBilan.setDate(dateReferenceBilan.getDate() + direction * 7);
  }
  afficherBilan();
}

document.getElementById('btnBilanPrecedent').addEventListener('click', () => changerPeriodeBilan(-1));
document.getElementById('btnBilanSuivant').addEventListener('click', () => changerPeriodeBilan(1));

document.querySelectorAll('.bilan-onglet').forEach(onglet => {
  onglet.addEventListener('click', () => {
    typePeriodeBilan = onglet.dataset.periode;
    dateReferenceBilan = new Date();   // on revient à la période en cours
    document.querySelectorAll('.bilan-onglet').forEach(o => o.classList.remove('actif'));
    onglet.classList.add('actif');
    afficherBilan();
  });
});


/* ============================================================
   17. ONGLETS
   ============================================================
   Cinq sections dans la page, une seule visible à la fois. L'onglet
   ouvert est inscrit dans l'adresse (#bilan) : un rechargement rouvre
   la même page au lieu de te renvoyer au calendrier.

   On écrit l'adresse avec replaceState plutôt qu'en affectant
   location.hash : ça met l'URL à jour sans empiler d'entrée dans
   l'historique. Sinon le bouton « retour » du téléphone ferait défiler
   les onglets un par un au lieu de quitter l'application.
   ------------------------------------------------------------ */

const VUES = ['jour', 'poids', 'bilan', 'seances', 'reglages'];
const VUE_PAR_DEFAUT = 'jour';

function activerVue(nom) {
  if (!VUES.includes(nom)) nom = VUE_PAR_DEFAUT;   // adresse farfelue : on retombe sur le calendrier

  document.querySelectorAll('.vue').forEach(vue => {
    vue.classList.toggle('actif', vue.id === 'vue-' + nom);
  });
  document.querySelectorAll('.onglet').forEach(onglet => {
    onglet.classList.toggle('actif', onglet.dataset.vue === nom);
  });

  history.replaceState(null, '', '#' + nom);
  window.scrollTo(0, 0);   // on arrive en haut de l'onglet, pas au milieu
}

document.querySelectorAll('.onglet').forEach(onglet => {
  onglet.addEventListener('click', () => activerVue(onglet.dataset.vue));
});

// Adresse changée à la main dans la barre du navigateur.
window.addEventListener('hashchange', () => activerVue(location.hash.slice(1)));

// Au chargement : l'onglet inscrit dans l'adresse, sinon le calendrier.
activerVue(location.hash.slice(1));


/* ============================================================
   18. DÉMARRAGE DE L'APPLICATION
   ============================================================
   Appelé une fois la session ouverte — soit par compte.js après une
   connexion réussie, soit par le bloc d'initialisation en fin de fichier
   si une session était déjà en cours.
   ------------------------------------------------------------ */

async function demarrerAppli() {
  document.getElementById('ecranConnexion').style.display = 'none';
  document.getElementById('appli').style.display = 'block';

  // Les champs de date sont pré-remplis à aujourd'hui.
  document.getElementById('champDatePoids').value = aujourdhui();
  document.getElementById('champDateRameur').value = aujourdhui();
  document.getElementById('champDateTapis').value = aujourdhui();

  monRole = await chargerRole();
  estLecteur = (monRole !== 'proprietaire');
  if (estLecteur) appliquerModeConsultation();

  const charge = await chargerDonnees();
  if (charge) toutAfficher();

  // Un compte absent de la table "acces" se connecte mais ne voit rien :
  // on l'explique, sinon l'application paraît simplement vide.
  if (monRole === null) {
    afficherStatut(raisonSansAcces || "Ce compte n'a accès à aucune donnée", 'erreur');
  }
}

/* ============================================================
   19. OUVERTURE DE LA SESSION
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
