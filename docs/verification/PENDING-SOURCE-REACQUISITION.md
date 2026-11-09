# Pending source trials and urgent food seeking

This increment makes urgent learned-food candidate selection use the same
pending-source restriction as ordinary appetite. It changes no reward, food
classification, stored evidence, physical action, or save format.

## Reproduction

The bounded current-world fixture authors a local encounter with one existing
tree, pays for pulling and sampling through the normal action engine, and waits
for real sustained feedback to establish an exact-source method. It then pays
for another pull and sample, leaving that new held material's feedback pending.
Only the final bodily appetite is supplied by the fixture.

On upstream `4cd307426f0dc1a515d212f6217139f7d411a367`, hungry selection defers
another learned acquisition, but ravenous selection immediately returns another
pull of that same tree. The regression test fails on that urgent selection.
The patch shares the existing ordinary-source guard with the urgent path.

## Boundaries

- This is a supplied controller consistency rule over retained personal trials,
  not a newly learned abstract concept or a demonstrated survival improvement.
- The restriction is exact-source and bounded by the existing 45-second wait.
  Matching feedback clears its pending marker. Other sources remain eligible.
- Actual sustained feedback reopens sampling of the held item. The existing
  exception for physically finished material with two distinct supported
  portions still permits acquisition while its final portion is pending.
- Existing runs and optional exploration are not globally forbidden from
  same-source actions. Tests deliberately choose inspection from the optional
  menu to isolate learned-candidate selection. They do not demonstrate
  autonomous waiting, ordinary-world encounter frequency, or lower mortality.
- Earlier safety, water, and supported held-food priorities are unchanged.
  Alternate-source selection and depleted-after-rest-refusal are supported by
  source review, not additional dedicated encounter tests in this increment.

## Validation

The pending-sample suite passes 63 tests, including both appetite branches,
actual feedback resumption, and the supported-finished-material exception.
The earlier combined pending-sample/capacity-release run passed 91 tests before
the additional finished-material test. The final three new controls also pass
independently after explicit hunger assertions were added. Independent review
found no blocking source or test defects. Build passes. The 39 adjacent
consumption/handling-feedback tests pass. The observer-parity test's explicitly
current-policy source pin was updated for this intentional policy change; its
18-case observer/no-observer/failure matrix then passes. Frozen scientific
fixtures and the separate frozen route-choice oracle are unchanged.

Native smoke was attempted in this cloud executor. Default profile resolution
failed; an isolated writable HOME/config/cache retry reached Electron's process
singleton but failed because socket creation is prohibited. No sandbox bypass
was used. Native close/reopen verification was blocked before execution by the
absence of a display and window manager. These are not native passes. The
user's Mac was not accessed. The aggregate `npm run check` completes successfully: 462 JavaScript modules
pass syntax checks, 2,126 tests pass, one is skipped, and none fail. Its run
includes the final pending-source controls and updated observer-parity matrix.
The following `npm run build` also passes.
