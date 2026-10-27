# Tentative remembered visual similarity

> This page documents the passive sensory-memory substrate. The new [model-proposed naming layer](MODEL-CATEGORY-NAMES.md) can reuse its conservative cue evidence; the memory module itself does not generate names or grant action authority.

This is private, passive memory, not category naming or behavioral generalization.
The simulator supplies the existing peer-method appearance abstraction: exact
shape, color and texture strings. Agents do **not** discover this similarity rule.

## Evidence and ingress

The declared threshold is two distinct individual IDs, each observed at two
distinct simulation times with the same complete cue triple. These are
**time-separated samples, not independent encounters**: remaining beside an
object can supply both. Ordinary `observeNpc` perception, through
`rememberObservation`, is the only ingress. Naming/speech refreshes, witnessed
consumption refreshes and action-result descriptions do not independently count.
Held-plus-visible duplicates and repeated same-time calls cannot add support.
Sleep, wrong-scene and occluded observations do not contribute.

Each actor owns at most 32 individual records, each retaining at most two sample
times. Changed cues reset support; a currently sensed incomplete triple removes
that individual's support. Mere absence is not disproof. Deterministic bounded
retirement does not pin ordinary observations, receipts or history. Groups are
derived from retained records rather than separately saved memberships. New
identities cannot inherit an old individual's samples.

## Display and limits

The selected actor's journal separates tentative remembered similarity from
individual names. It shows exact retained supporting times and distinguishes a
current ordinary visual sample from remembered-only membership. Rendering does
not sense, update evidence or advance time. Reloaded samples remain remembered
until actual ordinary perception occurs; loading alone cannot add a sample.

Other properties remain unknown: matching appearances do not establish food,
safety, behavior, a shared name or a category. Unseen retained members do not
become actionable. This increment changes no policy, action selection, speech,
tokens, aliases, experiment, effect transfer or peer memory.

## Persistence and verification

Optional bounded `discovery.visualSamples` remains within schema 12. Existing
valid current saves without this field remain valid. The current save boundary
rejects malformed, duplicate, over-capacity, foreign-owner and future evidence;
it does not silently repair it. This is data validation, not cryptographic proof
that a manually edited save's plausible historical observation actually occurred.

Controlled fixtures establish behavior under arranged exposure. Natural-frequency
runs, if reported, are diagnostics only, not evidence of independent encounters,
autonomous concept formation, useful categories or better survival. Native
screenshots and real close/reopen require the supported sandboxed desktop; Node
fixtures and prepare-only harness output never substitute for that evidence.
