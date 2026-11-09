# Ego Lite versus Playwright for the macOS port

**Recommendation: retain Playwright for the first macOS runtime; use Ego Lite for agent-driven QA now.** “AI-facing” makes Ego easier for an agent to inspect and operate, but does not make its interface compatible with this application's persistent browser controller. A later, explicitly scoped Ego adapter is feasible to investigate; a browser-name swap is not.

Scope: source/document review only, 2026-11-09. No Ego CLI invocation, browser operation, installation, login, credentials inspection, or implementation changes were performed for this assessment. Installed documentation and repository sources are the evidence, not a live adapter test.

## Evidence

### Installed Ego guide

The primary reference is **ego-browser usage guide v2.2.0 (macos)**, obtained from the installed application with `ego-browser skill`. To reproduce the documentation lookup, run that command against the relevant installed version and verify the terminating `[ego-browser:skill] end of guide` marker. This assessment read an already captured complete guide; it did not run the command itself. Later versions may differ.

References below point to this evidence section rather than a machine-local copy. Section titles are the durable lookup keys; line numbers identify the captured v2.2.0 output, not guaranteed offsets in future output:

- **Run browser scripts**, lines 7–40: ESM runtime, separate working directory, no inherited shell environment, custom rather than Playwright interface, and `help()` for detailed signatures.
- **Spaces, rounds, and pages**, lines 42–84: fresh Node process per invocation; persistent TaskSpaces/tabs/labels; explicit profile-selection permission and creation-only `profileId` at line 59; ownership and page lifecycle.
- **Page operations**, lines 86–163: documented methods, page-only callback scope, strict actions and limited selector syntax.
- **Visual pages: screenshot, mouse, and keyboard**, lines 173–198: screenshot returns a path; absolute output paths; native input behavior.
- **Page JavaScript and CDP**, lines 200–217: one JSON argument/result; no `evaluate()` timeout option; `executionStopped`/`mayHaveLateEffects`; page/task CDP routing and ephemeral target IDs.
- **Action receipts, popups, and dialogs**, lines 219–243: draining event buffer rather than EventEmitter; dispatch receipt does not verify application state.
- **User control and completion**, lines 298–332: stop on takeover; handoff, authorized resumption, finalization and update notices.

### Installed clearing-state reference

The second primary reference is the installed ego-browser skill's `references/clearing-state.md`, titled **Clearing cookies, cache, and storage**. Locate it within the skill installation for the relevant application version; no host-specific path or bundled content is redistributed here. Its opening paragraph (line 3 in the reviewed version) explicitly states that a profile's cookie jar and HTTP cache are shared with user tabs and other TaskSpaces on that profile. **The entry point does not limit the scope** (lines 20–24) explains why issuing CDP through one page does not limit effects to that page.

Repository links below identify functions rather than unstable line numbers. The Ego guide and reference are not copied into this repository; redistribution rights have not been established.

## What transfers, and what does not

| Concern | Current runtime | Ego evidence and consequence |
| --- | --- | --- |
| AI-assisted inspection | Programmatic DOM/media observation; application-owned validation. | Semantic snapshots, strict actions, cursor labels, screenshots and human handoff are valuable for QA. Action receipts still do not verify application state. [Page operations; Action receipts](<#installed-ego-guide>). |
| DOM extraction | `readPageState` in [core](<../core.mjs>) is largely a self-contained page callback. | `evaluate(fnOrString, argument)` supports one JSON argument/result and no captured Node variables. Pure DOM readers are plausible reuse candidates, not the whole controller. [Page JavaScript and CDP](<#installed-ego-guide>). |
| Elements | `currentVideo`, `switchVideo` and `captureSharedFrames` in [core](<../core.mjs>) use locator chaining, filtering, element evaluation and handles. | No inferred `locator()`, `getByRole()`, `context()` or `route()`. Limited selector compatibility is not locator compatibility. Identity/visibility/uniqueness checks require adaptation and testing. [Run browser scripts; Page operations](<#installed-ego-guide>). |
| Image evidence | `capture` in [core](<../core.mjs>) receives clipped JPEG bytes and rechecks overlays/video identity. | Documented screenshot returns a filesystem path. Need byte loading, bounds, cleanup and proven clip/format behavior. Raw `Page.captureScreenshot` is a possible lower-level path, not tested equivalence. [Visual pages; Page JavaScript and CDP](<#installed-ego-guide>). |
| CDP/events | [Browser host](<../browser-host.mjs>) and [watch mode](<../watch-mode.mjs>) use explicit sessions, detach, event listeners and window ownership checks. | Target/Browser commands belong on `task.cdp()`, page commands on `page.cdp()`. Raw CDP invalidates refs; target IDs must not persist across rounds. `page.events()` drains a buffer, not an EventEmitter. [Page JavaScript and CDP; Action receipts](<#installed-ego-guide>). |

### Persistent process ownership is the main mismatch

`endpoint` and `dedicatedHostReadiness` in [core](<../core.mjs>) spawn a detached browser host, retain PID/profile/port/readiness proof, reject an unowned CDP endpoint and reconnect later. `runBrowserHost` in [browser host](<../browser-host.mjs>) owns a headed persistent Edge context. `connectDedicatedBrowser` in [browser launcher](<../browser-launcher.mjs>) deliberately disconnects a cancelled connection without closing the Edge process.

Ego instead documents an external application with persistent spaces/tabs/labels and a **fresh Node process per invocation**. Script variables do not survive. It is not a documented embeddable SDK or replacement browser-host daemon. A runtime adapter would need an application-owned serialized command runner, bounded operations, persistent page-role records, restart reconciliation and availability/version diagnostics. The guide provides no general guarantee that killing a CLI wrapper cancels browser work. [Spaces, rounds, and pages; Page JavaScript and CDP](<#installed-ego-guide>).

The existing `BrowserController` queue and `acquireBrowserOperationLock` in [core](<../core.mjs>), plus shared API/DSH page roles in [browser pages](<../browser-pages.mjs>), remain necessary concurrency/accounting rules. Ego labels alone do not replace them.

### TaskSpace is NOT login/profile isolation

`resolveRuntimePaths` in [runtime paths](<../runtime-paths.mjs>) selects a dedicated profile directory, passed to `launchPersistentContext` by `runBrowserHost` in [browser host](<../browser-host.mjs>).

Ego's [installed clearing-state reference](<#installed-clearing-state-reference>) explicitly says cookies/cache are **shared with user tabs and every TaskSpace on the same profile**. TaskSpace ownership therefore does not establish a separate cookie jar, Chromium context, OS process or dedicated OS window.

Do not describe a QA TaskSpace as isolated login storage. A future dedicated Ego profile requires explicit user selection/authorization and verified binding on creation; `profileId` only applies at creation. Do not copy Edge cookies, auto-switch accounts or silently use personal login state. [Spaces, rounds, and pages](<#installed-ego-guide>).

### Background playback, silent mode and user control

In [watch mode](<../watch-mode.mjs>), `installSilentMode` and `apply` preserve/restorably change media mute state and install navigation-persistent behavior. `managedWindow` checks all tabs in the target OS window and rejects unmanaged/login/verification pages. Window restoration requires an explicit request. These methods do not emulate visibility or promise background playback.

Ego lists no `addInitScript()` or Playwright context-event interface. A CDP replacement may be possible, but scope, removal, navigation and restart behavior need validation. **Do not minimize a shared Ego window based only on TaskSpace ownership.** Preserve all-tabs window proof or declare minimization unsupported. Headed Chromium and persistent spaces do not establish minimized playback, audio, capture or power-saving equivalence on macOS. `installNativeFocusReset` in [browser host](<../browser-host.mjs>) also needs separate compatibility consideration. [Documented methods](<#installed-ego-guide>).

Ego requires stopping on user takeover or inactive/unassigned space, without retrying or routing around it. Handoff ends the round; reclaiming a user-owned/inactive space requires authorization. `finish()` invalidates labels and is not appropriate after a control interruption/error. These useful human-control semantics must map to the application state machine, not an automatic reconnect loop. [User control and completion](<#installed-ego-guide>).

`BrowserController.execute` and `close` in [core](<../core.mjs>) currently disconnect on abort, pause owned work on shutdown and drain the queue. An Ego adapter must distinguish **cancel requested**, **execution stopped**, **user control**, and **outcome unknown**. Respect `executionStopped` and `mayHaveLateEffects`; do not retry uncertain sends or perform cleanup pause/close after losing control. [Page JavaScript and CDP](<#installed-ego-guide>).

### External CLI/runtime limitations

Ego scripts are ESM, run in a separate working directory and **do not inherit shell environment variables**. Files require absolute paths and inputs must be explicit. Simply wrapping existing modules loses environment-driven configuration from `resolveRuntimePaths` in [runtime paths](<../runtime-paths.mjs>); importing the controller wholesale also loads [Playwright runtime](<../playwright-runtime.mjs>), contrary to Ego's documented usage. [Run browser scripts](<#installed-ego-guide>).

A future transport should use an explicit executable and argument/stdin execution, not shell interpolation; versioned result envelopes; output/time bounds; and sanitized non-secret inputs. Keep model credentials, memory, budgets and logs in the application process. Batch bounded browser work instead of launching one process per locator call. Process latency, exact Node/module compatibility, cancellation lifetime and screenshot option parity remain unverified. The guide directs `help()` for signatures; none was invoked in this assessment. [Run browser scripts; Spaces, rounds, and pages](<#installed-ego-guide>).

## Proposed future seam — small spike, not architecture rewrite

Keep the initial macOS port on its existing runtime and ownership model. If Ego becomes a concrete supported backend, investigate a domain-level **managed browsing module**, not a facade pretending to implement Playwright `Page`:

- Acquire/resume an explicitly selected managed session and report control/capabilities.
- Observe public video state and bounded frame/audio evidence; return sanitized data, not remote handles.
- Execute bounded actions against an expected video identity; return confirmed, blocked, user-controlled or uncertain outcomes.
- Stop/release only owned work, preserving drafts/user tabs and distinguishing disconnect from cancellation.

Start with an opt-in **read-only** adapter. Reuse pure in-page readers where safe; retain budgets, receipts, model calls and learning in the host. Do not introduce a speculative universal backend now. Locator-heavy [chat](<../chat-browser.mjs>), [comment dispatch](<../comment-browser.mjs>) and [share dispatch](<../video-forward.mjs>) make full parity a separate effort.

Acceptance gates: explicit profile isolation; restart/lost-control handling; bounded cancellation with late-effect reporting; truthful video/frame identity; navigation-persistent mute cleanup; all-tabs window proof or disabled minimization; no duplicate social action on timeout; fresh authorization before effects. Do not enable chat/comment/share in the read-only spike.

## Cost and decision

Planning judgments, **not measured promises**, for one engineer familiar with this code and an authorized test setup:

- **Ego QA now:** no runtime adapter. Inspect the app and exercise authorized synthetic UI flows in the existing QA space. This alone does not test the Playwright-to-Douyin runtime path.
- **Read-only compatibility spike:** **2–5 engineering days** for transport, state observation, bounded capture, restart and takeover tests. Deliver a go/no-go report, not “Ego supported.”
- **Useful watch-only adapter:** **1–3 additional weeks** if the spike passes, including control/ownership, capture/audio, stop/limits integration and conservative silent-mode capabilities.
- **Full social-action/runtime/packaging parity:** **several further weeks (roughly 3–6+)**; unresolved profile/process/control behavior could prevent parity altogether.

No benchmark, browser experiment or migration was performed. A narrow macOS portability patch plus Ego-assisted QA is the sensible fork strategy; a runtime adapter should remain a separate reviewed project.
