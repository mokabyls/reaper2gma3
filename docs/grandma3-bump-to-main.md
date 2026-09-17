# Plugin grandMA3 : Bump vers séquence principale

`R2MA_Bump_To_Main.lua` ajoute dans une séquence principale des cues vides
placées aux heures d'événements provenant d'une séquence bump.

Le plugin est prévu pour grandMA3 2.4.1 et 2.4.2. Il ne modifie pas la
séquence bump et ne copie aucune valeur de fixtures, recipe ou CuePart.

## Avant de commencer

1. Sauvegardez le show sous un nouveau nom.
2. Vérifiez que les séquences bump et principale possèdent chacune un track
   dans le même Timecode.
3. Videz complètement le Programmer. Le plugin bloque l'opération lorsqu'il
   détecte des valeurs actives, afin que les nouvelles cues restent vides.
4. Gardez le System Monitor visible pour consulter le plan complet et les
   commandes exécutées.

Les événements bump d'origine sont conservés. Après l'opération, le bump et la
nouvelle cue principale seront donc déclenchés au même instant jusqu'à ce que
vous décidiez vous-même de désactiver ou supprimer l'ancien événement.

## Installation

Le dépôt fournit un composant Lua autonome :
[`grandma3/R2MA_Bump_To_Main.lua`](../grandma3/R2MA_Bump_To_Main.lua).

Pour l'installer sans paquet XML :

1. Ouvrez une fenêtre **Plugin Pool** dans grandMA3.
2. Éditez un emplacement vide.
3. Ajoutez un composant Lua.
4. Nommez-le `R2MA_Bump_To_Main.lua`.
5. Ouvrez l'éditeur Lua, copiez le contenu du fichier et sauvegardez.
6. Fermez l'éditeur, puis touchez le plugin dans le pool pour l'exécuter.

Le fichier peut aussi être utilisé comme ressource locale par un plugin
grandMA3 déjà configuré pour charger des composants `.lua`.

## Utilisation

Le plugin affiche quatre sélections successives :

1. **Timecode** : le Timecode contenant les deux tracks.
2. **Séquence source** : la séquence bump.
3. **Cues source** :
   - une cue précise reprend toutes ses occurrences dans le Timecode ;
   - `Toutes les cues` reprend tous les événements source assignés à une cue.
4. **Séquence destination** : la séquence principale.

Si plusieurs `CmdSubTrack` du Timecode ciblent la même séquence, une sélection
supplémentaire permet de choisir le bon track.

Le dernier écran présente :

- le nombre de cues à créer ;
- les bumps ignorés parce qu'un événement principal existe déjà au même
  instant ;
- pour chaque insertion : l'heure, la cue source, la cue précédente, le
  nouveau numéro et la cue suivante.

Le détail complet est également écrit dans le System Monitor.

## Exemple de numérotation

Supposons que le track principal contienne :

| Heure | Cue principale |
| ---: | ---: |
| `10.000` | `45` |
| `20.000` | `46` |

Avec deux bumps à `12.000` et `14.000`, le plugin crée :

| Heure | Nouvelle cue |
| ---: | ---: |
| `12.000` | `45.1` |
| `14.000` | `45.2` |

Le numéro dépend donc des cues qui entourent temporellement le bump. Une cue
`1.1` ne peut pas être choisie entre les cues `45` et `46`.

Le plugin privilégie les numéros lisibles :

- dixièmes : `45.1`, `45.2`, … ;
- centièmes si nécessaire : après `45.9`, `45.91`, `45.92`, … ;
- millièmes en dernier recours.

Toutes les cues déjà présentes dans la séquence réservent leur numéro, même si
elles n'ont pas d'événement dans le Timecode.

## Commandes créées

Pour chaque bump retenu, le plugin exécute l'équivalent de :

```text
Store DataPool 1 Sequence 101 Cue 45.1 /Overwrite
Label DataPool 1 Sequence 101 Cue 45.1 "Nom du bump"
Store Timecode 1.1.2.1.1.15 /Overwrite
Set Timecode 1.1.2.1.1.15 Property "TIME" "12.000"
Set Timecode 1.1.2.1.1.15 Property "TOKEN" "Go+"
Assign DataPool 1 Sequence 101 Cue 45.1 At Timecode 1.1.2.1.1.15
```

L'adresse exacte du `CmdSubTrack` dépend du Timecode choisi.

Le plugin ne génère jamais :

- `Copy` de cue ;
- `Part` ou `StandardRecipe` ;
- `Cook` ;
- `Delete` sur la séquence ou les événements source.

Toutes les modifications sont exécutées par `CmdIndirectWait` et regroupées
dans une seule action d'annulation. Après un succès, un unique **Oops** annule
l'ensemble. En cas d'erreur détectée pendant l'écriture, le plugin ferme son
groupe d'annulation et lance automatiquement `Oops`.

## Cas bloquants

Aucune modification n'est faite lorsque :

- le Programmer contient des valeurs ;
- un Timecode ou un track demandé est absent ;
- une `CueDestination` existante ne peut pas être résolue ;
- les numéros des cues principales reculent lorsque le temps avance ;
- aucun numéro libre n'existe entre deux cues avec la précision maximale de
  trois décimales.

Un bump qui se trouve exactement à l'heure d'un événement du track principal
n'est pas bloquant : il est simplement ignoré et signalé dans le récapitulatif.

## Après l'opération

1. Vérifiez les nouvelles cues dans la Sequence Sheet.
2. Vérifiez leurs événements `Go+` dans le Timecode.
3. Encodez le contenu souhaité dans les nouvelles cues principales.
4. Lorsque le résultat vous convient, retirez manuellement les anciens
   événements ou la séquence bump si vous ne souhaitez plus le double
   déclenchement.
5. En cas de doute immédiat, utilisez une fois **Oops**.

Le plugin ne décide volontairement pas quand supprimer l'ancien bump : cette
étape reste manuelle pour ne jamais détruire un encodage déjà commencé.
