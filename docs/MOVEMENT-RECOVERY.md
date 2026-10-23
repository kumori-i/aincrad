# Bounded movement feedback and retracing

This increment refines existing blocked-movement feedback. It is separate from
structural swept-collision correction: physics makes a clear departure possible;
the agent still has to choose and pay for a useful action.

## Motor feedback

An active Ozark movement compares signed progress toward its current waypoint
with attempted distance over one second of **paid motor time**. Less than 2%
progress produces the existing `ROUTE_BLOCKED` receipt. The window resets after
assessment and at each waypoint. Slower bodily pace therefore changes elapsed
wall time, not the evidence threshold. Backward jitter cancels forward jitter;
passive river drift does not count as purposeful progress. Shorter actions can
still time out without falsely claiming a full stall window was observed.

Ordinary movement retains physical duration, exertion, collision, observation
admission and bounded routing. Wait, rest, sleep, timed object operations and
voluntary social holds are not attempted movement and create no motor window.
A blocked walk on apparently flat ground is no longer described as an observed
slope: climbing after resistance requires a locally seen divide.

## One uncertain retracing attempt

During ordinary paid dry-ground walking, the runtime keeps at most 32 sampled
positions from the actor's own last five seconds of movement. After an actual
blocked-walk receipt, it may propose a 12–24 pixel retreat toward this trail when
the actor next chooses an ordinary walk. It does not replace an interaction,
rest, sleep, swim, climb, or safety action. Urgent care, serious fatigue, sleepiness,
water underfoot, or recently experienced harmful contact veto it, even when no
immediate care action is available. Safety is rechecked during execution.

The target must remain locally visible in recently observed terrain. Admission
consumes the live receipt-linked opportunity and allows only that particular
non-center destination, with a nominal 0.75-second action limit checked on ordinary fixed steps. The ordinary action engine
charges time and effort and can reject the motion. It is not a teleport, a
certified path, a global obstacle search, or a promise of escape. A second attempt
in the same 40-pixel neighborhood is suppressed for 60 seconds, and the retreat's
own outcome cannot immediately produce another retreat.

Existing coarse failed edges remain unchanged. This short actual-trail attempt
does not consult those edges, so a coarse forward failure cannot itself prohibit
the immediate reverse attempt. An unsuccessful retreat does not add another
coarse edge. General directional route-memory refinement is not implemented.

## Persistence and limits

Motor windows, trails, pending opportunities, and cooldowns are runtime-only,
not new save fields. Existing earned action receipts remain saved normally.
Reopening interrupts an in-flight attempt, grants no success, and cannot recreate
permission from saved coordinates or receipts. Fresh paid movement and a new
failure are needed. Corrupt current-format saves still fail closed.

This is a supplied bounded response to own feedback, not an invented movement
strategy or a guarantee that every tree pocket can be escaped. A case with no
recent usable trail falls back to existing choices. The detector is per active
waypoint, not a general cross-action diagnosis of every short repeated mistake.
Shared attention and broad learning of alternate routes remain separate work.

## Verification

`tests/movement-recovery.test.mjs` covers frame partitions, signed jitter, creep,
slow valid travel, exhaustion, waypoint changes, partial actions, passive drift,
ordinary stationary actions, admission/replay rejection, finite failed retreats,
care/contact/water/visibility interruption, and current-codec save/reopen.
Its real forest fixture uses a controlled later-time scene at (240,3120), walks
into a trunk, records failure and physically retreats through the ordinary action
engine. This is not a fresh-world survival trial. Separate full-suite/build and
native desktop results must be reported for the exact release tree.

## Measured limits

This increment proves bounded feedback and a paid recovery option, not improved
aggregate navigation or autonomous survival. The unchanged seed-1, 25-second
controller scenes retain four and one ordinary post-failure goal arrivals,
respectively, after correcting non-center retreat anchor bookkeeping. Retreat
arrivals are counted separately. Against collision-only baseline, stationary
motor frames (displacement below 0.05 pixels per fixed step) increase from
2.30 to 3.93 seconds at (240,3120), and 4.07 to 5.67 at (320,3120). Net displacement
decreases from 442 to 161 pixels and 826 to 106 pixels; traveled distance changes
from 1322 to 2301 and 2424 to 2010 pixels. Different chosen goals make these mixed
results, not a universal speed or exploration improvement. The exact left detour
is separately tested as a normal paid route after recovery; it is no longer
required to be the free-running policy's chosen destination.

Only reached ordinary route centers update navigation anchors. A recovered
non-center trail point must not fabricate reaching the center of its coarse cell.
