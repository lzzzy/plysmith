# Live on Lichess

**Live** brings a Lichess game into Plysmith to play or watch. Finding an opponent and starting the game remain browser tasks. After a game ends, you can add it to your personal inventory if it interests you.

> The screenshot shows the real German setup state, not an active account or online game. The instructions use the English UI labels. See the [language and notation note](README.en.md).

## Connecting

First configure your [personal access](04-settings.en.md#lichess-access) under **Settings > Lichess** and restart Plysmith. Then set the switch in **Live** to **Online**.

[![Live before Lichess access has been configured](screenshots/live-offline.png)](screenshots/live-offline.png)

The screenshot shows the state before access is configured. After saving the token and restarting, the Online/Offline switch appears here.

The initial setting is **Offline**. Plysmith remembers your choice: once you deliberately choose **Online**, the app tries to reconnect at its next start. While connected, Plysmith detects your own game starts even when you are in another area of the app.

**Offline** disconnects. It does not end a game on Lichess or discard a recording that is already open. Reconnecting synchronises its state. However, a local live recording is not restored across a restart of Plysmith. Save a completed game before closing the app.

## Starting in the browser, playing in Plysmith

1. Stay **Online** in Plysmith and start a standard chess game in the Lichess browser.
2. **Ongoing Lichess game** appears in **Live**. Beside the name, you also see the rating provided by Lichess for this game, if available.
3. Choose **Play here** and make your moves on the board.

Not every Lichess game can be played through the Board API. If Plysmith reports **This game can only be played on Lichess.**, continue in the browser. Chess variants such as Chess960 are not supported.

During your own ongoing online game, analysis assistance is disabled throughout Plysmith, even if you play the game in the browser. This also affects Maia and local engine games. Going offline or restarting Plysmith does not lift a restriction already detected; Plysmith must be able to confirm with Lichess that the game has ended.

The clock counts down locally between time updates and is corrected by new updates. **Estimated time remaining** identifies this display. When disconnected, you see **Last reported time remaining**. A timeout is determined by the result confirmed by Lichess, not solely by a locally displayed zero.

**Resign** ends the game after confirmation. **Offer draw**, **Accept draw** and **Decline draw** are available as appropriate for the game state. **Abort game** may be offered at the very beginning. You cannot browse backwards during your own ongoing game.

## Watching and assessing

Open someone else's game on Lichess, copy its address and enter it in **Lichess game URL**. Choose **Watch**. Plysmith does not automatically detect which game you are viewing in a browser tab.

Plysmith brings in the moves already played and adds subsequent moves. Lichess spectator broadcasts are delayed, so they are not always in step with the browser. While recording, you can click earlier moves or step through them with the arrows. Recording continues while you do so.

Under **Assess position**, you see the configured engines for the position currently displayed. Read evaluations, outcome bars and Maia suggestions as described in [Settings and engines](04-settings.en.md#assess-position). This route to engine assistance is also unavailable during your own ongoing online game.

## Keeping the result

After the game ends, Plysmith synchronises the final moves and result. While **Completing game record** is displayed, this step is not yet finished. Once **Game finished** appears, you can choose a unique name and location, then **Save game**.

The saved game contains the complete recorded move sequence. Player names, result and Lichess address are included as an editable note. To leave the game out of your inventory, choose **Discard recording**. This removes only the recording in Plysmith; it does not end a game still running on Lichess. Plysmith also requires a decision when you leave an open recording.

After a connection loss, Plysmith tries to reconnect. If necessary, use **Refresh connection**. This also applies when the result is still missing and the game therefore cannot be saved. At **Awaiting move confirmation**, wait for synchronisation before making another move. If Lichess reports that no further request is currently allowed, try again later.

[Back to overview](README.en.md). Next: [Building an opening library](07-opening-library.en.md).
