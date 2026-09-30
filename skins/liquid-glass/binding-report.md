# Liquid Glass: binding report

Status: **incomplete**. Source: https://claude.ai/artifact/4Dtcsq4Mwn4F3psXDeVMTz

## Screens

| Harness screen | Artboard |
|---|---|
| lock | Main.dc.html |
| home | Home.dc.html |
| spaces | Brief.dc.html |
| discover | **missing**: design it in Claude Design, then re-install |

## Main.dc.html → lock

Lock screen over an orb wallpaper, with a Dynamic Island ride live activity, the date and clock, a glass Brief summary card, flashlight and camera buttons, and a swipe-up home link.

| Region | Role | Binding | Sample |
|---|---|---|---|
| Wallpaper orbs (#a2) | decoration |  |  |
| Status bar icons (#a8) | decoration |  |  |
| Dynamic Island ride activity (#a20) | live | `island.process.status`, `island.process.eta`, `island.process.label`, `island.process.detail`, `island.process.eta`, `island.process.progress` | Live activity: ride arriving in 4 minutes / 4 min / Your ride / Grey sedan · 7KX |
| Date and clock (#a46) | live | `now.date`, `now.time` | Wednesday, September 30 / 9:41 |
| Brief card (#a49) | live | `brief.summary` | Design review at 10:30. Leave by 10:05 — rain after 4. |
| Flashlight button (#a56) | control |  |  |
| Camera button (#a59) | control |  |  |
| Swipe up to open (#a64) | control |  |  |

Taps: #a21 → none; #a49 → navigate; #a56 → none; #a59 → none; #a64 → unlock.

Unmapped #a43: The ride's origin and destination labels ('1 Market St' → 'Studio 4') have no dedicated contract paths. Options: Replace the row with island.process.status text; Show island.process.label on the right and hide the origin; Remove the endpoints row.

## Home.dc.html → home

Home screen with a Dynamic Island ride activity, a glass Brief card (headline, summary and four brief rows), a 4x2 app grid, a search pill, a dock and a home indicator that locks the phone.

| Region | Role | Binding | Sample |
|---|---|---|---|
| Wallpaper orbs and scrim (a2) | decoration |  |  |
| Status bar clock (a9) | live | `now.time` | 9:41 |
| Status bar icons (a10) | decoration |  |  |
| Dynamic Island ride activity (a23) | live | `island.process.eta`, `island.process.label`, `island.process.detail`, `island.process.eta`, `island.process.progress` | 4 min / Your ride / Grey sedan · 7KXW219 / 4 min / 72% |
| Brief card header (a49) | live | `brief.updatedAt`, `brief.headline`, `brief.summary` | Wed · 9:41 / Focused morning, wet evening. / One meeting before noon. Rain rolls |
| Brief rows (a60) | live | each of `brief.items`: `title`, `line`, `badge` | Design review / 10:30 – 11:15 · Studio 4 / in 49m |
| App grid (a93) | live | each of `apps`: `name` | Mail |
| Search pill (a144) | control |  |  |
| Dock (a149) | decoration |  |  |
| Home indicator (a167) | control |  |  |

Taps: a23 → none; a49 → navigate; a60 → open (brief.items[].id); a94 → say (apps[].name); a145 → say; a150 → none; a153 → none; a157 → none; a162 → none; a167 → lock.

Unmapped a45: The ride's origin and destination ('1 Market St' → 'Studio 4') have no contract path. Options: Show island.process.status in place of the route line; Drop the route line; Show island.process.label split across the line.

Unmapped a101: The Calendar tile's live weekday and day-of-month (WED / 30) would be lost when the grid becomes a generic apps[] loop. Options: Keep a special Calendar tile outside the loop, bound to now.weekday and the day from now.date; Render all apps uniformly with apps[].icon; Drop the date from the tile.

Unmapped a156: The Messages dock badge '2' is a count of waiting messages, but the contract has no count path. Options: Show it only when waiting[] is non-empty, as a dot; Remove the badge; Hard-code it as decoration.

## Brief.dc.html → spaces

A scrolling brief view (canvas title 'User Spaces') with a ride live activity, the day's headline and summary, a Next up card, a Today timeline, a weather card, messages waiting on the user, and suggested action chips.

| Region | Role | Binding | Sample |
|---|---|---|---|
| Wallpaper orbs and scrim (#a2) | decoration |  |  |
| Status bar clock (#a8) | live | `now.time` | 9:41 |
| Status bar icons (#a9) | decoration |  |  |
| Dynamic island ride activity (#a21) | live | `island.process.eta`, `island.process.label`, `island.process.detail`, `island.process.eta`, `island.process.progress` | 4 min / Your ride / Grey sedan · 7KXW219 / 4 min / 72% |
| Top bar (close, title, share) (#a47) | control |  |  |
| Brief header (#a60) | live | `now.date`, `brief.updatedAt`, `brief.headline`, `brief.summary` | Wednesday, September 30 / 9:40 / Focused morning, wet evening. / One meeting bef |
| Next up card (#a64) | live | `brief.items[].badge`, `brief.items[].title`, `brief.items[].line`, `brief.items[].reason`, `brief.items[].cta` | in 49m / Design review / 10:30 – 11:15 · Studio 4, floor 3 / Agenda: deck v3 wal |
| Today timeline 'Now' marker (#a83) | live | `now.time` | 9:41 |
| Today timeline rows (#a89) | live | each of `today`: `time`, `title`, `detail` | 10:05 / Leave for Studio 4 / 14 min drive · ride booked |
| Weather card (#a128) | live | `needs.weather.values.now`, `needs.weather.values.summary`, `needs.weather.values.high`, `needs.weather.values.low`, `needs.weather.values.hour1`, `needs.weather.values.temp1`, `needs.weather.values.hour2`, `needs.weather.values.temp2`, `needs.weather.values.hour3`, `needs.weather.values.temp3`, `needs.weather.values.hour4`, `needs.weather.values.temp4`, `needs.weather.values.hour5`, `needs.weather.values.temp5`, `needs.weather.values.hour6`, `needs.weather.values.temp6` | 18° / Partly cloudy / 21° / 14° / 10A / 18° / 12P / 20° / 2P / 21° / 4P / 17° /  |
| Waiting on you (#a172) | live | each of `waiting`: `who`, `who`, `when`, `text`, `cta` | M / Maya / 9:12 / Can you look at deck v3 before 10:30? / Reply |
| Suggested action chips (#a186) | live | each of `documents[].actions`: `label` | Review deck v3 now |
| Footer note (#a198) | decoration |  |  |
| Home indicator (#a199) | control |  |  |

Taps: #a22 → none; #a48 → navigate; #a56 → none; #a79 → act (brief.items[].id); #a80 → act (brief.items[].id); #a179 → act (waiting[]); #a190 → act (documents[].actions[].label); #a199 → navigate.

Need **weather**: Get the current weather, today's high and low, and the temperature every two hours from 10 AM to 8 PM where the user is. Fields: now, summary, high, low, hour1, temp1, hour2, temp2, hour3, temp3, hour4, temp4, hour5, temp5, hour6, temp6; refresh every 30 min.

Unmapped #a44: The ride's start and end points ('1 Market St' → 'Studio 4'). Options: Drop the endpoint row; Show island.process.status in its place; Parse the destination from island.process.label.

Unmapped #a71: The Next up attendee avatars and 'Maya, Jon and 2 others'. Options: Remove the attendee row; Fold attendees into the item's line; Declare a need for event attendees.

Unmapped #a80: The second 'Open deck' button has no contract field. Options: Remove it and keep only the cta; Show the first document action label; Keep it as static copy.

Unmapped #a56: The share button has no skin command. Options: Remove it; Keep it as a no-op; Make it send a 'say' asking the agent to share the brief.

Problems:
- Interaction #a190 sends act with an id from "documents[].actions[].label"; act takes an id from brief.items or discover or waiting.

