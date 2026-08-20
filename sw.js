/* ============================================================
   SERVICE WORKER
   ============================================================
   Il met en cache l'habillage de l'application — pages, styles, scripts,
   icônes — pour qu'elle démarre instantanément et s'affiche même sans
   réseau. Les données, elles, viennent toujours de Supabase.

   ⚠️ À RETENIR SI TU MODIFIES LE SITE
   Un service worker garde les fichiers bien plus longtemps que le cache
   ordinaire du navigateur. Deux garde-fous sont en place :

     1. la stratégie « réseau d'abord » : tant que tu as de la connexion,
        tu vois toujours la dernière version en ligne ;
     2. le numéro de VERSION ci-dessous : l'incrémenter force la
        suppression de tout l'ancien cache.

   En cas de doute après une mise en ligne, incrémente VERSION.
   ------------------------------------------------------------ */

const VERSION = 'v3';
const CACHE = `suivi-${VERSION}`;

// L'habillage : tout ce qu'il faut pour afficher l'application.
const FICHIERS = [
  './',
  './index.html',
  './styles.css',
  './compte.js',
  './app.js',
  './vendor/supabase.js',
  './manifest.json',
  './icones/icone-192.png',
  './icones/icone-512.png',
  './icones/apple-touch-icon.png'
];

/* Installation : on remplit le cache, puis on prend la main tout de suite
   sans attendre la fermeture des onglets ouverts. */
self.addEventListener('install', evenement => {
  evenement.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(FICHIERS))
      .then(() => self.skipWaiting())
  );
});

/* Activation : on supprime les caches des versions précédentes. */
self.addEventListener('activate', evenement => {
  evenement.waitUntil(
    caches.keys()
      .then(noms => Promise.all(
        noms.filter(nom => nom !== CACHE).map(nom => caches.delete(nom))
      ))
      .then(() => self.clients.claim())
  );
});

/* Interception des requêtes : réseau d'abord, cache en secours.

   On ne s'occupe QUE des fichiers du site. Tout le reste — et en premier
   lieu les appels à Supabase — passe directement au réseau, sans jamais
   être mis en cache : des données de santé périmées seraient pires
   qu'une erreur de connexion franche. */
self.addEventListener('fetch', evenement => {
  const requete = evenement.request;

  if (requete.method !== 'GET') return;
  if (new URL(requete.url).origin !== self.location.origin) return;

  evenement.respondWith(
    fetch(requete)
      .then(reponse => {
        // Réponse valide : on rafraîchit le cache au passage.
        if (reponse && reponse.status === 200 && reponse.type === 'basic') {
          const copie = reponse.clone();
          caches.open(CACHE).then(cache => cache.put(requete, copie));
        }
        return reponse;
      })
      .catch(() => {
        // Hors ligne : on sert la version en cache si on l'a.
        return caches.match(requete).then(enCache => {
          if (enCache) return enCache;
          // Navigation sans rien en cache : on renvoie la page d'accueil.
          if (requete.mode === 'navigate') return caches.match('./index.html');
          return new Response('Hors ligne', {
            status: 503,
            statusText: 'Hors ligne',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      })
  );
});