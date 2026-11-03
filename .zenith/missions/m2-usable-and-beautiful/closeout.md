# Closeout — M2

**Incomplete, and here is exactly where.**

## Delivered

Write surface, agent depth, frontend rebuild, two migrations. 40 files,
+4,224 / −415, commit `80f3636`.

## Defects this mission found in its own new code

All three were caught by running the app, not by reading it.

1. **Icons across the RSC boundary.** Passing lucide components from a server
   layout into `AppShell` threw `Functions cannot be passed directly to Client
   Components`. Every route returned 500. Fixed with string keys resolved by a
   client-side map.
2. **`messages.body`.** The column is `content`. Lead 360 returned 500.
3. **A Delete button that did nothing.** `contacts_delete` is `USING
   (is_agency())`, so a client's DELETE affected zero rows — `DELETE 0` in the
   probe. Replaced with an archive action (an UPDATE the client may perform),
   with the reason stated in the UI.

Plus one property-level discovery: `escalation_policy` was selected by
`services/db.py` and then never referenced anywhere. The agency console let an
operator edit a rule with no effect. That is the same class of bluff this
project exists to eliminate, and it shipped in my own M1 rewrite.

## Not verified — stated plainly

- **No human has heard the agent speak.** Every route and query is proven; the
  audio leg is not.
- **No UI click-through was automated.** Create-caller and create-workspace are
  proven at the data layer (RLS probe) and by route status (200), not by a
  browser driving the form and asserting the resulting row. This is the single
  biggest gap in the evidence.
- **Live-call behaviour is unproven.** "Never invents a price", "escalates
  within two turns", "never claims an unconfirmed booking" are prompt-level
  assertions. They are not transcripts.
- **Contrast was not measured** in the three themes. The tokens are sane, which
  is not the same as WCAG-verified.
- **Skeletons exist but nothing renders them.** They are scaffolding, not a
  shipped loading state.

## What a runtime validator would add

Independent execution of the browser flows: drive `/portal/leads/new`, assert a
new row appears, then assert the same for `/agency/clients/new` and the settings
forms. That would convert VAL-CREATE-102/105 and VAL-SPACE-201/202 from PARTIAL
to PASS, and it is the check I could not perform honestly from inside the
session that wrote the code.

## Recommended next

1. A human makes one call and reports whether it speaks Danish and escalates.
2. SSE over `LISTEN/NOTIFY` on `ui_command_events` → dire modal (the sellable moment).
3. Meta webhook rebuild per READMEFIRST §4.4.
4. `next build`, alone, on the 8 GB machine.
