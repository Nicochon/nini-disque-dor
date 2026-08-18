# Suivi remise en forme

Application web personnelle de suivi quotidien : activités, douleur au dos, hydratation,
poids et performances (rameur, tapis).

Mobile-first, en HTML/CSS/JavaScript classique — pas de framework, pas d'étape de build.
Trois fichiers statiques, avec [Supabase](https://supabase.com) pour le stockage.

## Utilisation

Le site est servi par GitHub Pages. L'accès demande une connexion : sans elle,
aucune donnée n'est lisible.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page |
| `styles.css` | Mise en forme |
| `app.js` | Toute la logique : connexion, calendrier, badges, graphiques |
| `schema-supabase.sql` | Schéma de la base — tables, contraintes, sécurité |

`app.js` s'exécute après le chargement de la librairie Supabase : garder cet ordre
dans les deux balises `<script>` en fin de `index.html`.

## Sécurité

La clé Supabase présente dans `index.html` est une clé *publishable*, conçue pour être
visible dans le code source d'une page. Elle ne donne accès à rien par elle-même :

- la sécurité au niveau des lignes (RLS) est active sur les quatre tables ;
- le rôle anonyme n'a aucun privilège — toute requête non authentifiée est rejetée ;
- les inscriptions publiques sont désactivées sur le projet Supabase.

## Développement

Ouvrir le fichier via un serveur local, et non en `file://` — l'authentification
Supabase a besoin d'une origine web réelle :

```bash
python3 -m http.server 8000
# puis http://localhost:8000
```