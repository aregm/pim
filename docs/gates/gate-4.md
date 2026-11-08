# Gate 4: explained edges

**Run:** 2026-11-03, on the reference Mac, commit: the M4 commit. Driven through `kernel::relations`, `kernel::neighborhood`, `kernel::review`, `kernel::tag` and `kernel::retry` on the engine against the live vault of 27 items.

| Check | Result |
| --- | --- |
| Every edge answers the five questions (GRA-1) | PASS: 98 edges in a 22-node neighbourhood each carry type, author, evidence count, status, and the target's reason for being visible ("related_to (suggested) from linking-page.html") |
| Budget holds and hidden is reported (GRA-3) | PASS: budget 3 gave 3 nodes and 22 hidden; the default view (budget 150) shows only accepted edges |
| Link generators (GRA-2) | PASS: an HTML page that links to the captured Wikipedia article got an `explicit_link` relation with score 1 and the href; a note sharing "quorum", "kiosk", "rollout" got a `shared_terms` relation with evidence fragments on both ends; captures minutes apart got `co_capture` suggestions at score 0.1 |
| Accept and reject persist across a re-run (ADR-005) | PASS: after accepting the explicit link and rejecting a co-capture, re-running the link stage left both decisions in place, and the rejected relation was not re-proposed |
| Tags are entities shared across items | PASS: two items tagged "PIM reading" (one typed in lower case) share one tag entity; the neighbourhood around the tag shows both items and the accepted link between them |
| Backfill on upgrade | PASS: all 25 earlier items received a link job on the first start of M4 |
| Unit tests (17 Node, 4 Python), lint, type-check, build | PASS |
| Graph view (Sigma.js, ForceAtlas2), edge card, drag to pin, refocus, table and timeline projections; inbox keyboard triage j, k, a, r, Enter (UI-4) | NOT VERIFIED by automation: built and wired; open an item, press "Show in graph", click an edge |
| CI | NOT VERIFIED: no GitHub remote yet |

Notes: two defects were found and fixed during the run. The hand-off from the extract stage to the link stage was missing, so new items were never linked until the next start; and the explicit-link generator read only the readable HTML of web captures, not the raw HTML of a dropped file. On this test vault, where everything was captured within minutes, `co_capture` produced 122 suggestions; on real captures spread over days it is rare. It stays capped at five per item at score 0.1 and is easy to reject in bulk from the inbox.
