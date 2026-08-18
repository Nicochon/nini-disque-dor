# Suivi remise en forme

Application web personnelle de suivi quotidien : activités, douleur au dos, hydratation,
poids et performances (rameur, tapis).

Mobile-first, en HTML/CSS/JavaScript classique — pas de framework, pas d'étape de build.
Quatre fichiers statiques, avec [Supabase](https://supabase.com) pour le stockage.

## Utilisation

Le site est servi par GitHub Pages. L'accès demande une connexion : sans elle,
aucune donnée n'est lisible.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page |
| `styles.css` | Mise en forme |
| `compte.js` | Connexion à Supabase, authentification, droits, service worker |
| `app.js` | Le reste : calendrier, badges, poids, performances, sauvegarde |
| `manifest.json` | Déclaration pour l'installation sur l'écran d'accueil |
| `sw.js` | Service worker — cache de l'habillage du site |
| `vendor/supabase.js` | Librairie Supabase, servie localement plutôt qu'en CDN |
| `icones/` | Icônes de l'application |
| `document/schema-supabase.sql` | Schéma de la base — tables, contraintes, droits |

L'ordre des `<script>` en fin de `index.html` est important : la librairie Supabase,
puis `compte.js` qui crée le client et lit les droits, puis `app.js` qui s'appuie
sur les deux.

## Droits d'accès

Deux rôles, définis dans la table `acces` :

| Rôle | Peut faire |
|---|---|
| `proprietaire` | Tout lire et tout modifier |
| `lecteur` | Tout lire, ne rien modifier — ni saisie, ni suppression, ni export |

Un compte absent de la table `acces` peut se connecter mais ne voit aucune donnée.

Pour donner un accès en lecture, créer le compte dans le dashboard Supabase
(Authentication → Users → Add user), puis l'ajouter à la table `acces` avec le rôle
`lecteur` — la marche à suivre est détaillée en commentaire dans le fichier SQL.

Côté application, un compte lecteur voit un bandeau « Mode consultation », et toutes
les commandes de modification disparaissent. Ce masquage n'est qu'un confort :
la protection réelle vient des policies RLS, qui refusent l'écriture même si
l'interface était contournée.

## Sécurité

La clé Supabase présente dans `compte.js` est une clé *publishable*, conçue pour être
visible dans le code source d'une page. Elle ne donne accès à rien par elle-même :

- la sécurité au niveau des lignes (RLS) est active sur toutes les tables ;
- le rôle anonyme n'a aucun privilège — toute requête non authentifiée est rejetée ;
- l'écriture est réservée au rôle `proprietaire` ;
- les inscriptions publiques sont désactivées sur le projet Supabase.

## Installation sur le téléphone

Le site est une application installable (PWA). Sur Android, Chrome propose
l'installation ; sur iPhone, passer par Partager → « Sur l'écran d'accueil ».
Elle s'ouvre alors en plein écran, sans barre d'adresse.

L'application installée dispose de son propre stockage : il faut s'y connecter
une fois, même si la session était déjà ouverte dans le navigateur.

Sans réseau, l'interface s'affiche mais reste vide : les données viennent
toujours de Supabase, elles ne sont pas mises en cache.

## Développement

Ouvrir le fichier via un serveur local, et non en `file://` — l'authentification
Supabase a besoin d'une origine web réelle :

```bash
python3 -m http.server 8000
# puis http://localhost:8000
```

Après un déploiement, GitHub Pages met jusqu'à dix minutes à cesser de servir
l'ancienne version depuis le cache du navigateur (`cache-control: max-age=600`).
Forcer le rechargement avec Ctrl+Maj+R en cas de doute.

S'ajoute désormais le cache du service worker. Il est configuré en « réseau
d'abord » : tant qu'il y a de la connexion, c'est toujours la version en ligne
qui s'affiche. Si une mise à jour semble malgré tout ne pas passer, incrémenter
`VERSION` en tête de `sw.js` : tout l'ancien cache est alors supprimé.

Pour mettre à jour la librairie Supabase :

```bash
curl -sL "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2" -o vendor/supabase.js
```