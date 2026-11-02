# Player food demonstrations

The player now has a physical way to demonstrate one food action in the main Ozark world. Walk within sight and reach of a ripe apple tree, bramble, or loose fruit. **Gather** takes real time and effort, removing one finite portion only when the work completes. **Eat sample** swallows part of a held portion; the avatar's gut receives its actual nutrients and digestion runs with world time. **Drop rest** leaves the remaining portion in the world. Moving, pausing, opening a panel, or losing the window interrupts pending work; time and effort already paid are not refunded. A pending action is not saved or resumed.

This is a chance for an agent to learn, not a command to learn. Aster or Mira must personally see the completed consumption and its source. Even then, observation opens only an uncertain inquiry about that exact remaining piece. The agent must independently choose, travel, pay for acquisition and sampling, and experience its own delayed bodily result. Occlusion, distance, an unavailable remainder, competing needs, a failed swallow, or an agent's prior adverse history can prevent a useful trial. Nothing copies the player's nutrition result or intent into an agent. This milestone does not demonstrate reliable ordinary-world teaching or category transfer between different apples or berries.

The player can demonstrate berries as well as apples, but a berry is small. A 30 g sample from a 35 g berry leaves only 5 g; an apple leaves a larger remainder for an agent's own test. The material must remain reachable after the player drops it.

A controlled integration test places the player and agents beside an existing ripe apple tree and holds the agents' policies only during the short paid player demonstration. After the remainder is dropped, the player departs and the ordinary population controller chooses the agent's actions. In this authored physical setup, a visible swallow leads to the agent's own paid grasp, sample, and delayed bodily feedback; an occluded swallow with the same player actions and remaining portion creates no player-origin inquiry. This verifies that the autonomous policy path exists. It does not establish that agents will notice or use lessons reliably during ordinary survival, or that they generalize food categories.

## Typed Say and point lessons

In the **Your hands** panel, enter one to six lowercase `a`–`z` letters,
choose an object from the currently visible list and select **Say and point**.
Keep the avatar still for the 1.8-second paid action. Moving, opening a panel,
pausing or losing focus cancels the pending point; a partial action does not
become a lesson. Focus loss does not itself pause the world.

Each nearby agent must continuously see the real funded gesture and resolve its
referent uniquely using its own view. At completion it must also get a fresh
Canvas crop of that object. Occlusion, other visible objects along the gesture,
identity change, interruption or missing pixels can leave one or both agents
without a lesson. A completed example holds only the literal letters and that
individual's own numeric image features. The private bank retains up to 64
examples per individual; valid old saves begin with an empty player-word bank,
while a continuing individual resumes its examples. A replaced individual
starts empty. The Learning tab keeps player-word examples separate from the
agents' own character-message models.

An agent's bounded image-to-word predictor requires at least two alternatives
and can abstain. Its diagnostic guess is made before recording a new example;
it does not choose a survival action or teach the other agent. Repeating a word
with one rendered instance does not establish a category, an English meaning,
shared vocabulary or generalization to another object. No object identity,
food safety, recipe, reward or player intent enters the bank. The supplied
pointing and visibility rule is sensorimotor scaffolding, not learned language.
The Learning tab shows bounded pre-update prediction counts for the current
session. New words are excluded from the known-label comparison denominator;
these training-stream counts are not a held-out transfer score and are not saved.
The typed event is an in-world interface signal, not simulated hearing or a
learned speaking policy.

The native engineering check uses different existing object IDs for two later
Canvas crops. The sprite sensor renders each object alone and pools its pixels,
so a different ID can produce the same 48 numeric features as a training crop.
The check reports exact feature-input matches and distances before interpreting
its descriptive predictions. An ID-held-out result is not evidence of visual
transfer when its input is identical, and neither result establishes an ordinary
language skill.

Speaking aloud remains a later interface question. Microphone permission,
speech transcription, cloud upload, pretrained English interpretation and
voice learning are **not** included. Swimming imitation is also later work.
