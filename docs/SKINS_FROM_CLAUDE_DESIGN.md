# Installing skins from Claude Design: plan

**Status:** plan, not built. **Reference design:** "Liquid Glass Phone" (Claude Design canvas `4Dtcsq4Mwn4F3psXDeVMTz`): Lock Screen, Home Screen and Brief Detail, 390×844, interactive.

## 1. What we are building

An installer that takes a phone design made in Claude Design and turns it into a harness skin:

1. It reads the design's static screens.
2. A model decides which parts are live data (the brief, the Dynamic Island, the calendar, pending questions) and which are decoration (wallpaper, status bar, dock).
3. The static copy becomes bindings to the harness's data. The original copy stays as sample data.
4. The result plays in the Experience panel with live agent state, and still renders exactly as designed in Claude Design.

The key choice is to **keep the design in its own format**. A Claude Design artboard is a `.dc.html` file: HTML with `{{holes}}` (dotted lookups), `<sc-if>` and `<sc-for>`, `<dc-import>` for child components, links between artboards, and a `class Component extends DCLogic` whose `renderVals()` supplies the values. That is already a template language. So the installer does not generate new UI code. It rewrites literal copy into holes and loops, and makes `renderVals()` read from the harness. That gives us:

- **Fidelity:** the pixels are the designer's, not a re-implementation.
- **Round trip:** a bound artboard falls back to its original copy as sample data, so it still previews correctly in Claude Design and can keep being edited there.
- **Re-installable:** when the design changes, re-run the installer. Manual binding fixes are kept (§7).

## 2. Architecture

```
Claude Design canvas ──(1) fetch──► skins/<slug>/design/        original files, never edited
                                         │
                                   (2) analyze (model) ──► skins/<slug>/binding.json   SkinBindingPlan, human-editable
                                         │
                                   (3) rewrite + validate ──► skins/<slug>/bound/      .dc.html bound to the skin contract
                                         │
                                   (4) package ──► skins/<slug>/skin.json               manifest: screens, tokens, fallbacks
                                         │
Harness Experience iframe ◄── @harness/dc-runtime renders bound/ with the SkinViewModel; taps become commands
```

| Piece | Where | What |
|---|---|---|
| Skin contract v1 | `packages/core/src/types/SkinViewModel.ts`, `SkinCommand.ts` | The only data a skin sees, and the only things it can do (§3) |
| DC runtime | `packages/dc-runtime` | Our own renderer for the `.dc.html` subset (§4). We don't copy Claude Design's runtime. |
| Importer | `.claude/skills/install-skin/SKILL.md` + `scripts/install-skin.ts` | Fetches the canvas and localizes assets (§5) |
| Analyzer | `packages/skins/src/analyze.ts` | Model call per artboard → `SkinBindingPlan` (§6) |
| Rewriter and validator | `packages/skins/src/rewrite.ts`, `validate.ts` | Binds the artboards; lint, render and diff checks (§7) |
| Skin host | `apps/web/skin-host.html` | Loads a skin package in the Experience iframe (sandboxed) |
| Skins UI | harness top bar + a Skin panel | Install, switch, binding report, fix bindings |

## 3. The skin contract (v1)

Skins never see the raw `DeviceState` or memory. They see a **SkinViewModel** built by the host from the runtime snapshot. The contract is versioned so installed skins keep working as the runtime changes.

```ts
SkinViewModel {
  contract: 1
  now:       { iso, time, date, weekday }                                  // virtual clock
  locked:    boolean
  location:  string | null
  island:    { active, words, process: { label, status, detail, progress, eta } | null }
  brief:     { headline, summary, updatedAt,
               items: [{ id, title, line, cta, reason, icon, badge, topicId, documentId, needsAnswer }] }
  questions: [{ id, question, component: UiComponentSpec, context }]         // blocking asks (Spaces)
  documents: [{ id, title, description, sections, processes, actions }]      // Spaces tabs
  discover:  [{ id, title, line, cta, topicId }]
  today:     [{ time, title, detail, kind: "event" | "now" | "leave" | "weather" }]  // calendar and plans
  waiting:   [{ id, who, when, text, cta }]                                  // things waiting on the user
  apps:      [{ id, name, icon }]                                            // tools
  sample:    boolean                                                         // true while rendering sample data
}

SkinCommand = unlock | lock | say(text, via: "text" | "voice") | answer(questionId, action, values)
            | open(documentId | topicId) | act(itemId, cta) | dismiss(itemId) | seen(topicId) | navigate(screen)
```

The contract is **scalars and lists of plain objects only**: every field a template can bind to is a dotted path, and every list works with `<sc-for>`.

**Gaps the reference design exposes.** The Liquid Glass Home and Brief screens show things the runtime does not produce yet. The runtime needs these additions:

| Design shows | Contract field | Runtime change |
|---|---|---|
| Day headline and summary ("Focused morning, wet evening.") | `brief.headline`, `brief.summary` | Add `headline` and `summary` to `SurfacePlan` |
| Icon and trailing value on each brief row ("in 49m", "14m", "2") | `items[].icon`, `items[].badge` | Add `icon` (a fixed icon vocabulary) and `badge` to `SurfaceBriefEntry` as non-null strings. Mind Claude's 16-union limit. |
| "Today" timeline | `today[]` | Built by the host from calendar entries plus penciled-in plans; no model call |
| Live ride in the Dynamic Island (car, ETA, route, progress) | `island.process` | Built from the newest running `active_process` node |
| "Waiting on you" (Maya, Jon) | `waiting[]` | Add `waiting` to `SurfacePlan` (unanswered messages and asks from memory) |
| Weather strip | none | **No data source.** Options: a weather tool via the web built-in, an `ambient_state` node from a weather stream, or leave it static. The installer asks (§6). |

## 4. The DC runtime (`@harness/dc-runtime`)

This is a small renderer for the subset of the format that the reference design uses. We write it ourselves; we don't copy Claude Design's runtime.

- **Parse:** `<x-dc>` markup, `<helmet>` (fonts and style), and the `text/x-dc` script with its `data-props`.
- **Template:** `{{dotted.path}}` in text and attributes (whole-value attributes pass raw values, so `onClick="{{toggle}}"` works), `<sc-if value>`, `<sc-for list as>` with `$index`, and `<dc-import>` for sibling artboards.
- **Logic:** evaluate the `Component extends DCLogic` class with `props`, `state`, `setState` and `renderVals()`. React-style lifecycle is not needed for v1.
- **Props:** each artboard gets `props = { ...tweakDefaults, ...skinTweaks, skin: SkinViewModel }`. Design tweaks (font, wallpaper, accent, glass) become skin settings in the harness.
- **Navigation:** `<a href="Home.dc.html">` switches screens inside the skin, and `skin.json` maps artboards to Experience screens.
- **Sandbox:** the design's code is untrusted (the format's own docs say so). It runs only in the Experience iframe with `sandbox="allow-scripts"` (no same-origin) and a CSP that allows only the skin's own assets and Google Fonts CSS. Commands leave through `postMessage` only, and the host validates each one against `SkinCommand`.

**Done when:** the three reference artboards render in the harness with their original copy, tweaks change them, and links navigate. A screenshot of each matches the Claude Design render in a side-by-side review.

## 5. Getting the design (fetch)

The harness server can't sign in to claude.ai, so fetching happens in a Claude session, which can read canvases the user owns:

- **Skill (primary):** `.claude/skills/install-skin/SKILL.md`. You say "install the skin at https://claude.ai/artifact/…" in Claude Code. Claude lists the canvas's files and reads `project/canvas.json` and every `project/*.dc.html`. It downloads uploaded assets (`/_blob/…`) and writes everything to `skins/<slug>/design/`, then runs `npm run skin:install -- skins/<slug>`.
- **Manual:** place the canvas's files (`canvas.json` plus the `.dc.html` artboards) in `skins/<slug>/design/` and run the same command. This covers designs you already have on disk.

At fetch time:
- The canvas's `designSystems` tokens (if any) are copied.
- Every `/_blob/` URL is rewritten to a local file.
- Google Fonts links are kept, or vendored under `--offline`.
- The source URL, version and file hashes are recorded in `skin.json`, so re-installs can tell what changed.

## 6. Analysis: which parts are live? (model)

One structured model call per artboard (P1: the model reasons, code only validates). Input: the artboard source, a screenshot of it rendered with its sample copy, the skin contract, and the other artboards' titles and links. Output: a **`SkinBindingPlan`**, a new output schema kept inside the parity limits:

```
SkinBindingPlan {
  screen: "lock" | "home" | "spaces" | "discover" | "document" | "question" | "other"
  regions: [{ id, anchor, role: "live" | "decoration" | "control",
              slot, cardinality: "one" | "list", fields: [{ anchor, path, sample }], rationale }]
  interactions: [{ anchor, command, argsFrom }]
  unmapped: [{ anchor, what, options }]          // e.g. the weather strip
  missingScreens: [...]                          // screens the harness needs that the design lacks
}
```

`anchor` is a stable locator into the parsed markup: an element path, plus the `aria-label` or `<section aria-label>` when there is one. Accessible labels (`aria-label="Next up"`, `"Waiting on you"`, `"Suggested"`, `"Live activity: ride arriving in 4 minutes"`) are strong hints, and good designs have them.

**What the analysis should find in the reference design:**

| Artboard | Region | Binding |
|---|---|---|
| Lock | date and time | `now.date`, `now.time` |
| Lock | Dynamic Island (ride, "4 min", plate, route, progress bar) | `island.process.*`; the collapsed and expanded states stay local UI state |
| Lock | Brief card ("Design review at 10:30…") | `brief.items[0].title` / `line`; tap → Brief |
| Lock | flashlight, camera, status bar, wallpaper orbs | decoration |
| Lock | "Swipe up to open" | `unlock` + navigate to Home |
| Home | brief header ("Focused morning, wet evening.") | `brief.headline`, `brief.summary` |
| Home | four brief rows (icon, title, subtitle, trailing value) | `<sc-for>` over `brief.items`: `icon`, `title`, `line`, `badge` |
| Home | app grid | `<sc-for>` over `apps`; tap → open tool (v2) |
| Home | Search pill | `say` (opens text and voice input) |
| Home | dock | decoration |
| Brief | header date, "updated", headline, summary | `now.date`, `brief.updatedAt`, `brief.headline`, `brief.summary` |
| Brief | Next up (title, time, place, attendees, agenda, Directions / Open deck) | the first upcoming item in `today[]`; buttons → `act` with the item's CTAs |
| Brief | Today timeline | `<sc-for>` over `today` |
| Brief | Weather | **unmapped**: ask the user (§3 gaps) |
| Brief | Waiting on you (Maya, Jon, Reply) | `<sc-for>` over `waiting`; Reply → `act` |
| Brief | Suggested chips (already an `<sc-for>`) | rebind the list to `brief.items[].cta`; tap → `act` |

**Missing screens.** The harness needs Spaces (documents and blocking questions) and Discover, which the design doesn't have. The Brief artboard is close to a document view, so the plan maps `document` to it, with sections as an `<sc-for>`. Questions and Discover use **token-themed fallbacks**: the default skin's renderers, restyled with the design's extracted tokens (fonts, accent, glass blur, radius, wallpaper). The binding report can also offer to draw the missing screens in the same Claude Design canvas, in the same style, which you then re-install.

## 7. Rewrite and validate

**Rewrite (model plus code).** For each artboard, a model call rewrites the source using the binding plan:
- literal copy becomes holes
- repeated rows become one `<sc-for>` template
- `renderVals()` gains `const s = this.props.skin ?? SAMPLE`, where `SAMPLE` is the original copy in contract shape
- tapped elements get `onClick` handlers that post `SkinCommand`s

Decoration is left byte-for-byte. The output replaces `bound/<artboard>`; `design/` is never edited.

**Validate (code only, all must pass):**
1. **Format lint:** every hole is a dotted lookup (the format silently fails on expressions), elements are closed, attributes quoted, and every `<sc-for>` and `<sc-if>` has its `hint-*` attributes.
2. **Contract lint:** every bound path exists in `SkinViewModel`, and every region the plan marks live is bound.
3. **Fidelity:** render `design/` and `bound/` with sample data in headless Chromium. The pixel difference must be below a threshold. Binding should not change how the design looks.
4. **Stress:** render with empty lists, one item, ten items, very long titles, no island process, and a locked or unlocked phone. Capture overflow and clipping as screenshots in the report.
5. **Commands:** simulated taps on every interaction produce valid `SkinCommand`s.

Failures go back to the rewrite call with the lint messages, at most two retries per artboard, then they're shown in the report.

**Manual fixes survive re-installs.** `binding.json` is editable in the Skin panel (change a region's slot, mark something decoration). On re-install, unchanged artboards (same hash) keep their bound files, and changed ones are re-analyzed with your manual choices passed in as constraints.

## 8. In the harness

- **Top bar:** a skin picker (Default, Liquid Glass, …). Switching reloads the Experience iframe; the agent and memory are untouched.
- **Skin panel:**
  - install from a folder, with the Claude Code command to copy
  - installed skins with their source link and version
  - the **binding report**: each artboard shown three ways (original, bound with sample data, bound with live data), the region-to-slot table, unmapped regions with their options, stress screenshots, and lint results
  - buttons for re-install and for editing `binding.json`
- **Skin settings:** the design's tweaks (font, wallpaper, accent, glass) as controls, stored per skin.
- **Tests:** Playwright renders the installed reference skin against the scripted test server and checks that a question round-trips, the brief updates, the island shows a ride process, and the text and voice input work. These are the same guarantees the default skin has.

## 9. Milestones

| # | Milestone | Deliverables | Done when |
|---|---|---|---|
| **S1** | Skin contract | `SkinViewModel`, `SkinCommand`, host adapter from the runtime snapshot, `SurfacePlan` additions (headline, summary, icon, badge, waiting), the default skin moved onto the contract, sample fixtures | Default skin passes today's UI tests on the contract; parity check passes |
| **S2** | DC runtime | `@harness/dc-runtime` (template, logic, tweaks, navigation, sandbox), skin host page | The three reference artboards render with their original copy and tweaks, and links navigate |
| **S3** | Fetch | `install-skin` skill, `scripts/install-skin.ts`, asset localization, `skin.json` | The reference canvas installs into `skins/liquid-glass/design/` from its URL |
| **S4** | Analyze | `SkinBindingPlan` schema, analyzer, binding report view | The reference design's plan matches the §6 table, with the weather strip flagged |
| **S5** | Rewrite and validate | rewriter, linters, fidelity and stress renders, retry loop, manual-fix preservation | Bound artboards pass all five checks, and a live persona day drives the Liquid Glass lock screen, island and brief |
| **S6** | In the harness | skin picker, Skin panel, per-skin tweaks, Playwright tests for installed skins, token-themed fallbacks for missing screens | You can install, switch and use the Liquid Glass skin end to end, and CI covers it |

**Order and effort:** S1 and S2 come first and are pure engineering (no model calls). S3 to S5 are the "understand a design" part. S6 makes it usable. Model cost is two calls per artboard per install, plus retries.

## 10. Decisions for you

1. **Weather (and anything else unmapped):** give it a data source (a weather tool through the web built-in, or a simulated weather stream), hide it, or keep the designer's static copy?
2. **Missing screens:** use token-themed fallbacks for Spaces and Discover (fast), or draw them in Claude Design in this style first (better)?
3. **Write back to the canvas:** should the installer ever publish bound artboards or new screens back to a Claude Design canvas? The default is no: it only reads your canvas, and anything it creates goes to a copy you choose.
4. **Fonts:** load Google Fonts at runtime (simplest), or vendor them into the skin (works offline)?
