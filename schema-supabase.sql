-- ============================================================
--  Suivi remise en forme — schéma Supabase
--  À exécuter dans le SQL Editor du dashboard Supabase.
--
--  Le script est idempotent : tu peux le relancer sans risque,
--  il ne détruit aucune donnée existante.
--
--  ⚠️ AVANT DE LANCER CE SCRIPT :
--  1. Crée ton compte : Authentication > Users > Add user
--     (email + mot de passe, coche "Auto Confirm User")
--  2. Ferme les inscriptions publiques :
--     Authentication > Sign In / Providers > Email > "Allow new users to sign up" = OFF
--     Sans ça, n'importe qui pourrait créer un compte et lire tes données.
-- ============================================================


-- ------------------------------------------------------------
-- 1. LES TABLES
-- ------------------------------------------------------------

-- Un enregistrement par jour de suivi. La date sert de clé primaire :
-- ça rend l'upsert trivial côté application (on écrase le jour existant).
create table if not exists days (
  date          date primary key,
  kine_exo      boolean not null default false,  -- 🏠 exercices kiné à la maison
  sport         boolean not null default false,  -- 🏋️ séance en salle
  kine_seance   boolean not null default false,  -- 🧑‍⚕️ rendez-vous chez le kiné
  regime        boolean not null default false,  -- 🥗 journée sans écart
  velo          boolean not null default false,  -- 🚴 vélo
  douleur       int check (douleur between 0 and 10),  -- NULL = non renseigné, 0 = aucune douleur
  douleur_note  text,
  eau           int not null default 0 check (eau between 0 and 200)  -- en centilitres
);

-- Pesées : une seule par date (contrainte unique → upsert côté app).
create table if not exists weights (
  id      uuid primary key default gen_random_uuid(),
  date    date not null unique,
  weight  numeric not null check (weight > 0 and weight < 400)
);

-- Perfs rameur : plusieurs entrées possibles par date.
-- Le format du temps est validé : "4:06", "12:30"...
create table if not exists rameur (
  id     uuid primary key default gen_random_uuid(),
  date   date not null,
  temps  text not null check (temps ~ '^[0-9]{1,2}:[0-5][0-9]$')
);

-- Perfs tapis : plusieurs entrées possibles par date.
create table if not exists tapis (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,
  duree        numeric check (duree >= 0),   -- minutes
  vitesse      numeric check (vitesse >= 0), -- km/h
  inclinaison  numeric check (inclinaison >= 0) -- %
);

-- Index pour les listes triées par date décroissante.
-- (days et weights ont déjà un index via leur clé primaire / contrainte unique.)
create index if not exists idx_rameur_date on rameur (date desc);
create index if not exists idx_tapis_date  on tapis  (date desc);


-- ------------------------------------------------------------
-- 2. LES PRIVILÈGES
-- ------------------------------------------------------------
-- La clé publishable sera visible dans le code source du site.
-- On coupe donc tout accès au rôle "anon" (visiteur non connecté) :
-- même en trichant, sans être authentifié on ne peut rien lire ni écrire.

revoke all on days, weights, rameur, tapis from anon;
grant select, insert, update, delete on days, weights, rameur, tapis to authenticated;


-- ------------------------------------------------------------
-- 3. LA SÉCURITÉ AU NIVEAU DES LIGNES (RLS)
-- ------------------------------------------------------------
-- RLS activé = par défaut, plus personne n'a accès à rien.
-- Ce sont les "policies" ci-dessous qui rouvrent l'accès, et uniquement
-- à un utilisateur connecté.

alter table days    enable row level security;
alter table weights enable row level security;
alter table rameur  enable row level security;
alter table tapis   enable row level security;

-- On supprime d'éventuelles policies déjà en place avant de les recréer,
-- pour que le script reste rejouable.
drop policy if exists acces_utilisateur_connecte on days;
drop policy if exists acces_utilisateur_connecte on weights;
drop policy if exists acces_utilisateur_connecte on rameur;
drop policy if exists acces_utilisateur_connecte on tapis;

-- "for all"    : couvre select, insert, update et delete
-- "to authenticated" : uniquement les utilisateurs connectés (pas le visiteur anonyme)
-- "using"      : quelles lignes on peut lire / modifier / supprimer
-- "with check" : quelles lignes on a le droit d'écrire
create policy acces_utilisateur_connecte on days
  for all to authenticated using (true) with check (true);

create policy acces_utilisateur_connecte on weights
  for all to authenticated using (true) with check (true);

create policy acces_utilisateur_connecte on rameur
  for all to authenticated using (true) with check (true);

create policy acces_utilisateur_connecte on tapis
  for all to authenticated using (true) with check (true);


-- ============================================================
--  VARIANTE PLUS STRICTE (optionnelle)
-- ============================================================
--  Les policies ci-dessus ouvrent l'accès à TOUT compte connecté.
--  C'est sûr tant que les inscriptions publiques sont désactivées
--  (voir l'avertissement en haut du fichier).
--
--  Si tu préfères verrouiller sur TON compte précisément — ceinture
--  ET bretelles — récupère ton identifiant avec :
--
--      select id, email from auth.users;
--
--  puis remplace les 4 policies ci-dessus par celles-ci, en collant
--  ton UUID à la place de 00000000-0000-0000-0000-000000000000 :
--
--  create policy acces_utilisateur_connecte on days
--    for all to authenticated
--    using (auth.uid() = '00000000-0000-0000-0000-000000000000')
--    with check (auth.uid() = '00000000-0000-0000-0000-000000000000');
--
--  (et la même chose pour weights, rameur et tapis)
-- ============================================================


-- ============================================================
--  SI TES TABLES EXISTAIENT DÉJÀ
-- ============================================================
--  "create table if not exists" ne modifie pas une table existante :
--  les contraintes de validation (douleur 0-10, format du temps rameur...)
--  n'auront donc pas été ajoutées. Pour les poser après coup, exécute
--  les lignes ci-dessous une par une (une erreur "already exists" signifie
--  simplement que la contrainte est déjà là — tu peux l'ignorer) :
--
--  alter table days   add constraint days_douleur_check check (douleur between 0 and 10);
--  alter table days   add constraint days_eau_check     check (eau between 0 and 200);
--  alter table weights add constraint weights_weight_check check (weight > 0 and weight < 400);
--  alter table rameur add constraint rameur_temps_check check (temps ~ '^[0-9]{1,2}:[0-5][0-9]$');
-- ============================================================