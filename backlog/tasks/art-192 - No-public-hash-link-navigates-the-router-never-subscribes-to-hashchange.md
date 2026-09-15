---
id: ART-192
title: 'No public hash link navigates: the router never subscribes to hashchange'
status: In Progress
assignee: []
created_date: '2026-09-15 15:22'
updated_date: '2026-09-15 15:48'
labels: []
dependencies: []
priority: high
ordinal: 190000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Clicking any link on any public page changes the address bar and leaves the page exactly where it was. Reproduced in a real browser against deterministic fixture data: from the home page, clicking 林映雪 under 核心角色 moved the URL to #character/mistwood/lin-yingxue while the h1 stayed on the home page's.

PublicRoute in src/App.tsx reads window.location.hash during render and never subscribes to hashchange. A hash link fires no navigation and reloads nothing, so React is never told the route changed. Every public link is affected: the character links on the home page and in an Episode, the arc links, the timeline's 查看本日故事, the Episode page's 上一集 and 下一集, the recommended-episode call to action, and 返回首頁 in the shared page frame.

This was found by following a link rather than by loading a URL, which is why the browser suite never caught it. Every existing spec navigates with page.goto(), a full load, and a full load reads the hash correctly.

RelationshipGraphView already solved this for itself. Its useLocationHash docblock states the rule exactly:

  Every other public page reads window.location.hash once during render and gets away with it,
  because none of them links to a DIFFERENT hash of the SAME route — following a link from #arc/…
  to #character/… re-enters PublicRoute through a different branch and remounts.

The first half is right and the second is wrong: re-entering PublicRoute requires PublicRoute to render again, and nothing makes it. The graph page works only because it built its own subscription; every other page inherited the assumption.

The fix is one subscription in the router, shared with the graph page rather than duplicated — the hook is already written and already documents why the listener is registered in an effect and torn down with the component.

Verification must follow a link, not load a URL. A spec that asserts the destination after page.goto() passes today.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Following a link from one public page to another renders the destination, in a real browser
- [ ] #2 Following 上一集 / 下一集 on the Episode page renders the neighbouring Episode, including across an unpublished day
- [ ] #3 Changing the hash of the SAME route re-renders — the relationship graph's date stepper keeps working and is not made to pay for a second subscription
- [ ] #4 Browser back and forward move between public pages
- [ ] #5 One subscription, shared: the graph page stops carrying its own copy
- [ ] #6 Fault injection: removing the subscription fails a NAMED browser test rather than only slowing something down
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
- [ ] #2 Relevant automated tests are added or updated
- [ ] #3 Typecheck passes
- [ ] #4 Lint passes
- [ ] #5 Relevant tests pass
- [ ] #6 Build passes when applicable
- [ ] #7 No known regression is introduced
- [ ] #8 No secret or credential is committed
- [ ] #9 Documentation is updated
- [ ] #10 PRD traceability is updated when applicable
- [ ] #11 Implementation notes are complete
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Found by FOLLOWING a link rather than by loading one, during the ART-193 screenshot review. Clicking 林映雪 on the home page moved the URL to #character/mistwood/lin-yingxue and left the h1 on the home page's.

PublicRoute read window.location.hash during render and subscribed to nothing. A hash link fires no navigation and reloads nothing, so React was never told the route moved.

RelationshipGraphView had already solved this for itself under ART-44, and its docblock stated the rule half wrong: a cross-route link does NOT 're-enter PublicRoute through a different branch and remount', because re-entering PublicRoute requires PublicRoute to render again. The graph worked because it subscribed; every other page inherited the assumption. The hook moves to its own module and both use it — one subscription, not two.

Why a full browser suite missed it: every spec navigates with page.goto(), a full load, and a full load reads the hash correctly. Nothing anywhere followed a link. The new spec states that as its own rule — goto may only reach the starting page.

The individual pages needed no change. They read window.location.hash during render too, which is CORRECT once the router re-renders: a same-route hash change reconciles the component and it re-reads, and a cross-route change mounts a new one.

## Fault injection

Restoring the render-time read fails 7 of 8 tests by name. The survivor is the graph's date stepper — exactly right, since it carries its own subscription and is why it was the one page where following a link ever worked.

An earlier version of one assertion did NOT fail under that injection: it read not.toContainText('-') on a heading, and the Episode heading 「世界第 7 天」 contains no hyphen either, so it passed on a page that had not navigated. Replaced with the destination's exact name and URL; the re-run fails it.
<!-- SECTION:NOTES:END -->
