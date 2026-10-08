# Working on topics in parallel with contexts

Your inventory remains your personal, deliberately selected collection. **Working contexts** let you work on several topics within it in parallel, such as "Italienisch vertiefen" (exploring the Italian opening) and "Endspieltraining" (endgame training). Each context brings together the relevant entries and your work on them. You are improving the same inventory and adapting it to your needs.

> The screenshots retain the real German UI. The example context names stay in German to match them; controls use their English labels here. See the [language and notation note](README.en.md).

## Putting a context together

In **Manage**, use the plus beside **Working contexts** to create a context. A name such as "Italienisch vertiefen" is enough. Later, **Edit working context** lets you add a **Description** explaining what you want to work on.

[![Working context in Manage with assigned inventory entries](screenshots/context-inventory.png)](screenshots/context-inventory.png)

Within the active context, select the **All inventory** view, find "Manual - Italienische Eröffnung" and add it with **Use in context**. You can add several checked entries together with **Add selection to working context**.

The selections serve different purposes:

| Selection                                              | Effect                                                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **Working context** at the top                         | Switches between a named context and **All inventory** as its own workspace              |
| In **Manage**: **In this context** / **All inventory** | Shows the active context's entries or also the rest of the inventory within that context |
| **Folders** / **Origins**                              | Organises the visible entries by location or actual origin                               |

The inventory view within a context helps you find more material. It does not switch the active workspace. You can view entries outside the context. To open such an entry here for analysis, first add it to the context or switch to **All inventory** at the top. Management actions such as renaming or deleting, however, affect the shared inventory here too.

Adding an entry creates no copy. The same entry can be used in several contexts while retaining its unique inventory name and shared folder location.

Plysmith remembers the choice of **Folders** or **Origins** separately for All inventory and each working context, including after a restart.

## Folders as working destinations

**Include folder in working context** adds a folder and its current subfolders as storage destinations. You can select **Also include the current records in these folders**. Without this selection, adding the folder alone does not fill the context with its contents.

Later entries and new subfolders are not added automatically. You explicitly decide what belongs to the topic. When saving or moving within a context, you can choose from the folders available there. **Unfiled** also remains a possible location. Moving changes the shared inventory entry's folder, even when you perform the action from within a context.

## Your notes and work in progress

Open the Italian analysis in the "Italienisch vertiefen" context. Its saved moves and general notes are the same as in the inventory. Now add a note at a half-move and pay attention to its scope:

- **Only in Italienisch vertiefen** records, for example, a question for this topic. The option names your active context. The note does not appear in your other contexts.
- **General** adds to the shared entry and is also visible outside this context.

[![Analysis in a working context with general and context-specific notes](screenshots/context-analysis.png)](screenshots/context-analysis.png)

General notes appear on a grey background; context notes use a yellowish background with a gold-coloured line. When editing, you can explicitly see whether a note is **General** or **This context only**. A general note stays general even when you edit it from within a context.

Analysis paths and remembered analysis positions are separate for each workspace. You can begin a provisional path in "Italienisch vertiefen", work in another context and return to your investigation later. Plysmith remembers analysis paths across restarts too. They are still drafts, not saved variations or new entries.

If an existing analysis draft stands in the way of opening another entry, Plysmith offers **Continue existing analysis** or **Discard draft and open item**. Discard it only when you no longer need the investigation.

A new separate analysis or new game saved from within a context becomes part of the inventory. For a separate analysis, set **Save destination** to either **Inventory only** or **Inventory + Italienisch vertiefen**, with the second option naming your active context. When saving a game from **Play out**, **Also use in this context** determines whether it is added to the current topic. A game saved in **Live** is automatically used in the active working context as well.

## Changing shared moves deliberately

A saved variation and changes to the main line belong to the inventory entry. They do not apply only to the context in which you worked. Other contexts may therefore be affected, especially if their notes or unsaved investigations are attached to moves being removed.

Before choosing **Save**, check the comparison of **Previous version** and **New version**. It shows which moves remain, are added or are removed. If Plysmith reports **Saving removes work from these contexts**, it also lists the affected notes and unsaved analyses. Those consequences take effect when you save. Switching contexts alone does not protect against such changes to the shared entry.

For other affected contexts, **New version available** may appear instead. **Review change** opens the comparison so you can decide how the context should continue. Until you decide, that context still uses the previous version. There are three options:

| Decision                                         | Effect                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Use new version**                              | Switches to the changed entry. Check the listed consequences for notes, drafts and remembered positions.     |
| **Keep previous version as a separate analysis** | Actually creates a separate analysis under a new, unique name and continues the context-specific work there. |
| **Remove analysis from context**                 | Removes its use and the associated context work. The inventory entry remains.                                |

When adopting a new version, notes whose references no longer fit are archived; other affected work in progress may be removed or reset. The preview lists the consequences of your choice. If anything is lost, you must also confirm the decision.

[![Reviewing a new version with a comparison, consequences of saving and three choices](screenshots/context-revision-review.png)](screenshots/context-revision-review.png)

You can reproduce the screenshot with your working analysis: also add "Manual - Italienisch mit d6" to a second context, "Eröffnung vergleichen" (comparing openings). In "Italienisch vertiefen", add a context note at **4.Nc3**, such as "Play out this continuation in the next training session." Switch to **All inventory** at the top and shorten the working analysis by removing its last main line move, **4.Nc3**. Check the consequences and save.

Back in "Italienisch vertiefen", you must now decide how this topic should continue with the new version. The imported Italian opening remains unchanged. If an analysis is used in only one working context, that context may already switch to the new version when you save; the preview lists the consequences in that case too.

Here, the separate analysis is a deliberate copy. It is created only by this decision, not when a working context is created. The context notes and work in progress continue on the copy. General notes remain with the original entry and are not copied. The current context then uses the copy.

## Finishing or tidying up a topic

**Remove from context** removes only the entry's use in that context. Its associated context notes and work in progress are lost; the entry itself and other contexts remain. Similarly, **Delete working context** removes the whole topic and its own context work, but not the inventory entries.

**Delete from inventory** has a wider effect: the entry disappears along with its uses and associated content. Check the loss preview before confirming. A folder can also be removed from a context; the affected context work is listed as part of that action. Deleting a folder from the inventory, by contrast, keeps its entries under **Unfiled**.

To finish, keep the insights that should remain part of your chess: as general notes, deliberately saved continuations or separate analyses. The working context has then served its purpose by helping you develop your personal collection.

[Back to overview](README.en.md).
