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
| `compte.js` | Connexion à Supabase, authentification, droits du compte |
| `app.js` | Le reste : calendrier, badges, poids, performances, sauvegarde |
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