# Tableau de bord

Le tableau de bord est le premier écran que vous voyez après la connexion. Il fournit un **aperçu rapide** de l'état global de l'architecture d'entreprise.

![Tableau de bord - Vue supérieure](../assets/img/fr/01_tableau_de_bord.png)

## Barre de navigation supérieure

En haut de l'écran, vous trouverez la **barre de navigation principale** avec les éléments suivants :

- **Turbo EA** (logo) : Cliquez pour revenir au tableau de bord depuis n'importe quelle section
- **Tableau de bord** : Aperçu de l'état de l'architecture
- **Inventaire** : Liste complète de toutes les fiches
- **Rapports** : Rapports visuels et analytiques
- **BPM** : Gestion des processus métier (si activé)
- **Diagrammes** : Éditeur visuel de diagrammes d'architecture
- **EA Delivery** : Gestion des initiatives d'architecture
- **Tâches** : Tâches en attente et enquêtes assignées
- **Rechercher des fiches** : Barre de recherche rapide avec autocompletion
- **+ Créer** : Bouton pour créer rapidement de nouvelles fiches
- **Cloche de notification** : Alertes système et [notifications](notifications.md)
- **Icône de profil** : Sélection de la langue, bascule de thème, préférences de notification et accès à l'administration

## Fiches récapitulatives

La section principale du tableau de bord affiche des **fiches récapitulatives** indiquant :

- **Nombre total de fiches** : Comptage de tous les composants enregistrés dans la plateforme
- **Répartition par type** : Combien d'éléments de chaque type existent (Applications, Organisations, Objectifs, Capacités, etc.)
- **Aperçu des statuts** : Visualisations rapides de l'état général

Cliquer sur une fiche de type redirige vers l'[Inventaire](inventory.md) pré-filtré sur ce type.

![Tableau de bord - Vue inférieure avec graphiques](../assets/img/fr/02_tableau_de_bord_bas.png)

## Graphiques et statistiques

Dans la section inférieure du tableau de bord, vous trouverez :

- **Graphique de répartition par type** : Montre la proportion de chaque type de fiche dans votre paysage
- **Statut d'approbation** : Indique combien de fiches sont approuvées, en attente, cassées ou rejetées
- **Qualité des données** : Pourcentage global de complétude des informations sur toutes les fiches
- **Activité récente** : Un fil des derniers changements -- qui a modifié quoi et quand

## Onglet «Espace de travail»

L'onglet **Espace de travail** rassemble tout ce qui vous est assigné : favoris, tâches, sondages en attente, activité récente sur vos cartes et la section **Cartes où j'ai un rôle**.

Cette dernière groupe les cartes par rôle de partie prenante que vous occupez (Application Owner, Business Owner, etc.) et liste les cartes sous chaque rôle. Si votre rôle accorde la permission `stakeholders.view` (admin, member et viewer par défaut), une petite icône **person_search** apparaît à côté du titre de la section : sélectionnez un utilisateur dans l'autocomplétion et la section se recharge avec ses rôles et ses cartes. Le titre devient «Rôles tenus par {name}». Cliquez sur la petite icône de fermeture pour revenir à vos propres rôles. Utile pour répondre à «que possède cette personne ?» en un clic.
