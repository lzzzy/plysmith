# Building an opening library

With the tools covered so far, you can gradually develop your inventory into a personal opening library. Begin with a few positions you actually play or want to understand, then add your own questions and continuations.

> The screenshots show the German UI and the original sample names. Instructions use English labels and notation. See the [language and notation note](README.en.md).

## A shared beginning

The analysis "Manual - Grundstellung", which has no moves, can be the starting point for such a library. You do not need a long move sequence yet.

[![Saved analysis consisting only of the initial position](screenshots/root-only-analysis.png)](screenshots/root-only-analysis.png)

For a small library around 1.e4, you can proceed as follows:

1. Open "Manual - Grundstellung" and play 1.e4 on the analysis board.
2. Choose **Save as separate analysis** and enter the name "Repertoire - 1.e4". The new entry contains this first continuation and has a genuine origin connection to "Manual - Grundstellung".
3. Open "Repertoire - 1.e4" and select the position after 1.e4. Try 1...c6, for example, and save the path as a separate analysis called "Repertoire - Caro-Kann".
4. For another reply, begin again at 1.e4 in "Repertoire - 1.e4". You can create another separate analysis for 1...e5 in the same way.

The individual analyses remain manageable. Each derived analysis begins at its chosen starting position, while the source move sequence shows how you reached it. This lets you develop the library from a shared beginning without entering the same preceding moves over and over.

## Using folders and origins together

A folder such as "Repertoire" gives these topics a logical location. The **Origins** view in **Manage**, by contrast, shows which analyses were actually derived from each other.

[![Origins view with an analysis derived from the Italian opening](screenshots/inventory-origin.png)](screenshots/inventory-origin.png)

Our existing example "Manual - Italienisch mit d6" demonstrates the same approach: the separate analysis was derived from the position after 3.Bc4. Importing from the same PGN alone did not create this relationship. Identical names, identical positions or a shared folder do not automatically connect entries into a provenance family either.

## Finding the right size

For closely related alternatives, a **variation** within the same analysis is often enough. A **separate analysis** is useful when you want to pursue a continuation as a topic in its own right. **Notes** record the plans, transpositions or open questions that matter to you.

Use engines to check ideas and **Play out** to test them in practice. Keep the results that improve your library. Later changes to a source are not automatically applied to existing derived analyses. Check for yourself whether a new insight should also be reflected in your other analyses.

The next chapter introduces working contexts for working on several topics in parallel.

[Back to overview](README.en.md). Next: [Working on topics in parallel with contexts](08-contexts.en.md).
