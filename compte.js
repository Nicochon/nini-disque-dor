/* ============================================================
   GESTION DU COMPTE
   ============================================================
   Ce fichier regroupe tout ce qui touche à l'identité : la connexion à
   Supabase, l'authentification, et les droits du compte connecté.

   Il doit être chargé AVANT app.js, qui s'appuie sur le client "bdd"
   et sur les variables de rôle définies ici.
   ------------------------------------------------------------ */


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
   LES DROITS DU COMPTE CONNECTÉ
   ============================================================
   Deux rôles, définis dans la table "acces" côté Supabase :
     · proprietaire — lit et modifie tout
     · lecteur      — consulte, sans rien pouvoir changer

   Un compte absent de cette table ne voit aucune donnée.
   ------------------------------------------------------------ */

/* Rôle du compte connecté, lu dans la table "acces" au démarrage :
   'proprietaire' (tous les droits) ou 'lecteur' (consultation seule). */
let monRole = null;
let estLecteur = false;


/* Barrière posée en tête de chaque action de modification.
   Renvoie true — et interrompt l'action — si le compte est en lecture seule.
   Ce n'est qu'un garde-fou d'interface : même contourné, l'écriture serait
   refusée par les policies RLS de Supabase. */
function verrouille() {
  if (estLecteur) {
    afficherStatut('Mode consultation : modification impossible', 'erreur');
    return true;
  }
  return false;
}


/* Lit dans la table "acces" le rôle du compte connecté.
   Les policies RLS font que chacun ne voit que sa propre ligne. */
/* Quand le rôle ne peut pas être déterminé, on garde ici la raison :
   ça évite de chercher longtemps pourquoi l'application semble vide. */
let raisonSansAcces = null;

async function chargerRole() {
  raisonSansAcces = null;
  try {
    const { data: { user } } = await bdd.auth.getUser();
    if (!user) {
      raisonSansAcces = 'Session expirée — reconnecte-toi.';
      return null;
    }

    const { data, error } = await bdd
      .from('acces')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      // 42P01 : la table n'existe pas encore côté Supabase.
      raisonSansAcces = (error.code === '42P01')
        ? 'Table « acces » absente : exécute schema-supabase.sql dans Supabase.'
        : 'Lecture des droits impossible : ' + error.message;
      return null;
    }

    if (!data) {
      raisonSansAcces = "Ce compte n'est pas autorisé : aucune ligne dans « acces ».";
      return null;
    }
    return data.role;
  } catch (e) {
    raisonSansAcces = 'Pas de connexion au serveur.';
    return null;
  }
}

/* Bascule l'interface en lecture seule : le CSS se charge de masquer
   les commandes d'écriture et d'afficher le bandeau. */
function appliquerModeConsultation() {
  document.body.classList.add('mode-lecture');
}


/* ============================================================
   CONNEXION ET DÉCONNEXION
   ============================================================ */

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
