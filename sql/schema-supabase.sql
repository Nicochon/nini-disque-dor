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
--
--  MODÈLE DE DROITS
--  Deux rôles, définis dans la table "acces" :
--    · proprietaire : lit et modifie tout (toi)
--    · lecteur      : lit tout, ne peut rien modifier (kiné, médecin…)
--  Un compte qui n'est pas listé dans "acces" ne voit strictement rien,
--  même s'il parvient à se connecter.
-- ============================================================


-- ------------------------------------------------------------
-- 1. LES TABLES DE DONNÉES
-- ------------------------------------------------------------

-- Un enregistrement par jour de suivi. La date sert de clé primaire :
-- ça rend l'upsert trivial côté application (on écrase le jour existant).
create table if not exists days (
  date          date primary key,
  kine_renfo    boolean not null default false,  -- 💪 exercices kiné de renforcement
  kine_mobilite boolean not null default false,  -- 🤸 exercices kiné de mobilité
  sport         boolean not null default false,  -- 🏋️ séance en salle
  kine_seance   boolean not null default false,  -- 🧑‍⚕️ rendez-vous chez le kiné
  regime        boolean not null default false,  -- 🥗 journée sans écart
  velo          boolean not null default false,  -- 🚴 vélo
  douleur       int check (douleur between 0 and 10),  -- NULL = non renseigné, 0 = aucune douleur
  douleur_note  text,
  eau           int not null default 0 check (eau between 0 and 200)  -- en centilitres
);

-- Les exercices kiné se déclinent en deux types : renforcement et mobilité.
-- Avant cette distinction, une seule colonne "kine_exo" les portait, et tout
-- ce qui y est enregistré est du renforcement — on la renomme donc, sans
-- rien perdre, puis on ajoute la mobilité à côté.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'days' and column_name = 'kine_exo'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'days' and column_name = 'kine_renfo'
  ) then
    alter table days rename column kine_exo to kine_renfo;
  end if;
end $$;

alter table days add column if not exists kine_mobilite boolean not null default false;

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
create index if not exists idx_rameur_date on rameur (date desc);
create index if not exists idx_tapis_date  on tapis  (date desc);


-- ------------------------------------------------------------
-- 2. LA TABLE DES ACCÈS
-- ------------------------------------------------------------
-- Qui a le droit de faire quoi. Un compte absent de cette table
-- ne voit rien : c'est le point de contrôle unique.

create table if not exists acces (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  role     text not null check (role in ('proprietaire', 'lecteur')),
  libelle  text,                              -- "Kiné", "Médecin traitant"…
  cree_le  timestamptz not null default now()
);

-- Le compte le plus ancien (le tien) devient propriétaire.
-- Sans cette ligne, plus personne ne pourrait rien modifier.
insert into acces (user_id, role, libelle)
select id, 'proprietaire', coalesce(email, 'compte principal')
from auth.users
order by created_at asc
limit 1
on conflict (user_id) do update set role = 'proprietaire';

-- Garde-fou : on refuse de continuer s'il n'y a aucun propriétaire,
-- sinon le script te verrouillerait hors de tes propres données.
do $$
begin
  if not exists (select 1 from acces where role = 'proprietaire') then
    raise exception 'Aucun propriétaire défini : crée d''abord ton compte dans Authentication > Users, puis relance ce script.';
  end if;
end $$;


-- ------------------------------------------------------------
-- 3. LES FONCTIONS DE CONTRÔLE
-- ------------------------------------------------------------
-- Ces deux fonctions répondent à "qui es-tu ?" et servent dans toutes
-- les policies ci-dessous.
--
-- "security definer" est indispensable : il fait tourner la fonction avec
-- les droits de son créateur, ce qui lui permet de lire la table "acces"
-- sans repasser par les policies de cette table. Sans ça, une policy qui
-- consulte "acces" déclencherait une récursion infinie.

create or replace function public.a_acces()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from acces where user_id = auth.uid());
$$;

create or replace function public.est_proprietaire()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from acces where user_id = auth.uid() and role = 'proprietaire'
  );
$$;

grant execute on function public.a_acces()        to authenticated;
grant execute on function public.est_proprietaire() to authenticated;


-- ------------------------------------------------------------
-- 4. LES PRIVILÈGES
-- ------------------------------------------------------------
-- La clé publishable est visible dans le code source du site.
-- On coupe donc tout accès au rôle "anon" (visiteur non connecté) :
-- sans être authentifié, on ne peut rien lire ni écrire.

revoke all on days, weights, rameur, tapis, acces from anon;
grant select, insert, update, delete on days, weights, rameur, tapis to authenticated;
grant select, insert, update, delete on acces to authenticated;


-- ------------------------------------------------------------
-- 5. LA SÉCURITÉ AU NIVEAU DES LIGNES (RLS)
-- ------------------------------------------------------------
-- RLS activé = par défaut, personne n'a accès à rien.
-- Les policies ci-dessous rouvrent l'accès, de façon différenciée
-- selon le rôle.

alter table days    enable row level security;
alter table weights enable row level security;
alter table rameur  enable row level security;
alter table tapis   enable row level security;
alter table acces   enable row level security;

-- On supprime les policies existantes avant de les recréer,
-- pour que le script reste rejouable.
drop policy if exists acces_utilisateur_connecte on days;
drop policy if exists acces_utilisateur_connecte on weights;
drop policy if exists acces_utilisateur_connecte on rameur;
drop policy if exists acces_utilisateur_connecte on tapis;

drop policy if exists lecture       on days;
drop policy if exists ecriture_ajout on days;
drop policy if exists ecriture_maj   on days;
drop policy if exists ecriture_suppr on days;
drop policy if exists lecture       on weights;
drop policy if exists ecriture_ajout on weights;
drop policy if exists ecriture_maj   on weights;
drop policy if exists ecriture_suppr on weights;
drop policy if exists lecture       on rameur;
drop policy if exists ecriture_ajout on rameur;
drop policy if exists ecriture_maj   on rameur;
drop policy if exists ecriture_suppr on rameur;
drop policy if exists lecture       on tapis;
drop policy if exists ecriture_ajout on tapis;
drop policy if exists ecriture_maj   on tapis;
drop policy if exists ecriture_suppr on tapis;

-- Lecture : ouverte à tout compte listé dans "acces" (propriétaire ou lecteur).
create policy lecture on days    for select to authenticated using (a_acces());
create policy lecture on weights for select to authenticated using (a_acces());
create policy lecture on rameur  for select to authenticated using (a_acces());
create policy lecture on tapis   for select to authenticated using (a_acces());

-- Écriture : réservée au propriétaire. Trois policies distinctes, car
-- insert, update et delete se déclarent séparément.
create policy ecriture_ajout on days    for insert to authenticated with check (est_proprietaire());
create policy ecriture_maj   on days    for update to authenticated using (est_proprietaire()) with check (est_proprietaire());
create policy ecriture_suppr on days    for delete to authenticated using (est_proprietaire());

create policy ecriture_ajout on weights for insert to authenticated with check (est_proprietaire());
create policy ecriture_maj   on weights for update to authenticated using (est_proprietaire()) with check (est_proprietaire());
create policy ecriture_suppr on weights for delete to authenticated using (est_proprietaire());

create policy ecriture_ajout on rameur  for insert to authenticated with check (est_proprietaire());
create policy ecriture_maj   on rameur  for update to authenticated using (est_proprietaire()) with check (est_proprietaire());
create policy ecriture_suppr on rameur  for delete to authenticated using (est_proprietaire());

create policy ecriture_ajout on tapis   for insert to authenticated with check (est_proprietaire());
create policy ecriture_maj   on tapis   for update to authenticated using (est_proprietaire()) with check (est_proprietaire());
create policy ecriture_suppr on tapis   for delete to authenticated using (est_proprietaire());

-- La table "acces" elle-même : chacun lit sa propre ligne (l'application
-- s'en sert pour savoir dans quel mode se placer), et seul le propriétaire
-- peut distribuer ou retirer des accès.
drop policy if exists lire_son_role      on acces;
drop policy if exists proprietaire_gere  on acces;

create policy lire_son_role on acces
  for select to authenticated using (user_id = auth.uid());

create policy proprietaire_gere on acces
  for all to authenticated using (est_proprietaire()) with check (est_proprietaire());


-- ============================================================
--  DONNER UN ACCÈS EN LECTURE
-- ============================================================
--  Étape 1 — créer le compte dans Authentication > Users > Add user :
--     email    : jobservelesgros@gmail.com
--     mot de passe : celui de ton choix, à transmettre à la personne
--     coche "Auto Confirm User"
--  Les inscriptions publiques restent fermées : c'est toi qui distribues
--  les accès, un par un.
--
--  Étape 2 — l'autoriser en lecture (à exécuter après avoir créé le compte) :
--
--      insert into acces (user_id, role, libelle)
--      select id, 'lecteur', 'Invité'
--      from auth.users
--      where email = 'jobservelesgros@gmail.com'
--      on conflict (user_id) do update set role = 'lecteur';
--
--  Étape 3 — vérifier que la ligne est bien là :
--
--      select a.role, a.libelle, u.email
--      from acces a join auth.users u on u.id = a.user_id
--      order by a.role;
--
--  POUR RETIRER L'ACCÈS :
--
--      delete from acces
--      where user_id = (select id from auth.users
--                       where email = 'jobservelesgros@gmail.com');
--
--  Supprimer la ligne suffit : le compte peut toujours se connecter,
--  mais ne voit plus rien. Pour le fermer complètement, supprimer aussi
--  l'utilisateur dans Authentication > Users.
-- ============================================================


-- ============================================================
--  VÉRIFIER QUE TOUT EST EN PLACE
-- ============================================================
--  Qui a quel rôle :
--
--      select a.role, a.libelle, u.email
--      from acces a join auth.users u on u.id = a.user_id
--      order by a.role;
--
--  Quelles policies s'appliquent :
--
--      select tablename, policyname, cmd
--      from pg_policies
--      where schemaname = 'public'
--      order by tablename, cmd;
--
--  Attendu : pour days, weights, rameur et tapis, une policy SELECT
--  (lecture) et trois policies INSERT/UPDATE/DELETE (écriture).
-- ============================================================