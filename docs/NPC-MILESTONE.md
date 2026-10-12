# Requested next milestone — specification only

Not implemented in this recovered v0.1.0 exploration build.

You are implementing the next development milestone of my existing game, Aincrad.

Build one persistent, embodied NPC that develops useful water-gathering behavior through experience. The NPC must be able to fail, collapse from dehydration, receive rescue water, recover, and continue with its memories intact.

Implement the feature in the supplied project. Do not stop at an architecture proposal.

First inspect the existing code, identify the engine, runtime, persistence system, world clock, movement, collision, and interaction architecture, and then adapt this specification to the actual project. Preserve existing functionality. Do not assume that a remote repository has already been created or published.

Make reasonable implementation decisions where needed, document them, and keep this milestone small and runnable.

1. PROJECT CONTEXT AND SCOPE

The existing world is a mountain-bounded valley with a lake/river, meadows, trees, and enterable caves. A human-controlled avatar can explore it.

The map is intended to take approximately five real minutes to cross on foot. The intended clock is one real hour per in-game day. Verify what is actually implemented before changing timing.

Add exactly one learning NPC alongside the human-controlled avatar.

This milestone includes:
- Hydration, water collection, drinking, collapse, and rescue.
- Local perception, persistent memory, and learned reusable procedures.
- A simple inspection/debug interface and automated tests.

Do not add a society, professions, combat, reproduction, a full economy, general crafting, or additional survival needs yet.

2. WHAT “BOTTOM-UP LEARNING” MEANS FOR THIS IMPLEMENTATION

The developer defines physical rules, senses, possible actions, and motivations. The NPC develops knowledge of its surroundings and reusable procedures through interaction.

Use model-assisted decision-making with persistent experience and a validated skill library. Model fine-tuning is not required.

Start with an empty learned-skill library and no preloaded water-source coordinates.

Do not hardcode a complete survival routine such as:
“When hydration is low, walk to these coordinates, fill the flask, and drink.”

It is acceptable to provide movement, collision handling, a navigation helper, interaction mechanics, and thresholds that request a new decision. Those are infrastructure, not learned skills.

It is also acceptable for the underlying pretrained model to understand ordinary words such as water, flask, and thirst. Do not describe this as a blank-slate mind or claim that all its knowledge was learned in the game.

The implementation must demonstrate that stored experiences and learned skills affect later action selection. Generating diary entries alone does not satisfy the requirement.

3. AVATAR AND WORLD AUTHORITY

Represent the NPC as a normal game entity with a controller separate from its body.

Where practical, share movement and interaction infrastructure with the human-controlled avatar.

The game engine is authoritative over position, collision, inventory, hydration, interaction range, water availability, elapsed time, and rescue.

The agent can request actions but cannot directly modify these values or claim that an action succeeded.

Use structured action requests and structured engine results. Validate every action before execution.

Keep actions bounded in duration so that an unfinished command cannot lock the NPC indefinitely.

4. HYDRATION, COLLECTION, AND DRINKING

Add a configurable hydration value from 0 to 100.

Hydration decreases while the NPC is conscious according to elapsed simulation time, not rendering frame count.

Give the NPC one simple empty flask. Implement capacity and current contents without building a general inventory system unless one already exists.

For this milestone:
- Water collection fills the flask at an accessible water source.
- Drinking consumes water from the flask and increases hydration.
- Filling the flask alone does not increase hydration.
- Drinking from an empty flask fails.
- Interacting from outside the permitted range fails.
- Hydration and flask contents cannot exceed their limits.

Water sources and valid interaction positions must obey the actual terrain and collision rules.

Use existing water locations where possible. Do not require the NPC to enter impassable water tiles to collect water.

Choose configurable initial hydration and depletion rates that leave enough time to discover and reach an available source. Account for travel time and model latency.

Similarly, rescue must leave a realistic gameplay opportunity to recover independently. Do not create an unavoidable cycle in which the NPC revives with too little hydration to reach water.

Include an accelerated development preset for testing several survival cycles quickly, separate from ordinary gameplay settings.

5. COLLAPSE AND RESCUE

Implement an explicit lifecycle, such as:

AWAKE -> COLLAPSED -> RECOVERING -> AWAKE

At zero hydration, the NPC collapses and becomes unable to move or perform ordinary actions.

Cancel or suspend outstanding actions and record the collapse as an authoritative event.

Collapse is not permanent death. Do not create a new NPC identity, erase its memory, reset its discovered map, or clear learned skills.

After a configurable interval, the NPC receives rescue water and recovers with partial hydration.

Do not completely refill its flask as part of automatic rescue. Rescue should stabilize it, not complete its independent water-gathering task.

Keep revival at the collapse location or the nearest safe adjacent location. Do not teleport it to a lake, its destination, or another advantageous location.

Collapse should cost usable in-game time. Avoid permanently reducing its survival capacity or making repeated failures progressively impossible to escape.

Make transitions idempotent: one collapse produces one corresponding rescue/recovery sequence, even if events or callbacks are delivered more than once.

6. RESCUE NARRATIVE: GODS OR THE PLAYER

Implement configurable rescue presentation.

Default mode: divine rescue.
A brief diegetic event communicates that a benevolent presence has supplied water. This can initially be text and a simple visual effect; elaborate art is not required.

Optional mode: player-assisted rescue.
The human-controlled avatar can approach the collapsed NPC and explicitly give water through a validated interaction.

Implement the required player water possession/consumption rules if this mode is included. Do not silently fabricate a player interaction.

An optional divine fallback may rescue the NPC if the player does not intervene within a configured interval. Record the actual rescuer accurately.

Divine rescue is a world mechanic. It is not a tool the NPC can call whenever it wants water.

Record what the NPC could perceive during recovery. Distinguish:
- Verified world outcomes, such as hydration increasing after rescue.
- Observed attribution, such as the player visibly helping.
- Narrative interpretation or uncertain belief about the intervention.

Do not let the NPC “remember” seeing the player perform an action that never occurred.

An example post-event memory might be:
“I lost consciousness after becoming severely thirsty. I woke after receiving water from a benevolent presence.”

Any additional lesson about changing its behavior should be generated from its actual experience and tested in subsequent actions. Do not insert a complete water-gathering strategy as part of revival.

7. PERCEPTION AND AVAILABLE ACTIONS

Use structured local observations for the first implementation, not screenshot-based control.

Observations should include the NPC’s condition, flask contents, locally visible objects and terrain, relevant recent events, current action status, and retrieved personal memories.

Do not expose the complete map, undiscovered water-source coordinates, objects behind occlusion, or the player’s private state.

Maintain a remembered map based on actual observations. Mark remembered resource information with a last-observed time or validity status.

Provide a small action vocabulary suitable for the existing engine, for example:

observe
move
inspect
fill_flask
drink
wait

Action names and schemas may explain basic controls, but do not supply the complete successful sequence as a starting skill.

A navigation helper may navigate through known traversable terrain. It must not reveal hidden source locations or route the NPC through unexplored obstacles using privileged map knowledge.

8. PERSISTENT EXPERIENCE, KNOWLEDGE, AND SKILLS

Persist three distinct kinds of information.

Experience:
An event history containing observations, attempted actions, authoritative results, hydration changes, collapses, and rescues.

World knowledge:
Remembered locations, water-source availability, traversability, and beliefs supported by observations. Include freshness or uncertainty where appropriate.

Skills:
Reusable, parameterized procedures supported by successful experience.

A skill should contain an identifier, parameters, preconditions, bounded steps, success checks, failure conditions, supporting experience references, and a validation history.

For example, a procedure could eventually combine approaching a known source, filling a flask, and drinking. However, do not seed that procedure into the initial skill library.

Save the same NPC identity, needs, inventory, lifecycle state, discoveries, experience, and skills across game restarts.

Use persistence appropriate to the actual runtime. Do not introduce an unnecessary server or database solely because a preferred technology exists.

Handle interrupted saves and restarts during collapse/recovery without duplicating rescue or erasing progress.

9. EXPERIENCE-DRIVEN LEARNING LOOP

Implement this loop:

Observe.
Retrieve relevant memories and skills.
Choose a known procedure or propose a bounded experiment.
Execute through the validated action interface.
Evaluate using actual engine outcomes.
Store the experience.
Create, revise, validate, or retire candidate skills.
Use those changes in later decisions.

A successful sequence initially becomes a candidate skill. Record additional evidence when it works from another starting position, at another discovered source, or after a relevant environmental change.

Do not mark a procedure universally reliable after one success.

On failure, retain the specific outcome:
“Target out of reach.”
“Route blocked.”
“Flask empty.”
“Source unavailable.”

Use that information to adjust subsequent attempts rather than repeating the same invalid action indefinitely.

Following collapse and rescue, retrieve relevant recent events and produce a compact evidence-based lesson or revised hypothesis.

Distinguish a known cause from a guess. For example, “hydration reached zero” is verified; “I should have taken a different route” may be a hypothesis.

The lesson must be available to subsequent planning and skill selection, not just displayed in the UI.

10. MOTIVATION AND FEEDBACK

Give the NPC an explicit high-level objective of remaining conscious and becoming independently capable of meeting its water need.

Do not give it a scripted route or daily schedule.

Track the provenance of hydration increases. Distinguish ordinary drinking from divine rescue, player rescue, and debug commands.

Evaluate independent water acquisition separately from rescue.

A collapse is an unsuccessful survival outcome. Rescue permits continued experience but must not receive the same success credit as obtaining and drinking water independently.

Do not automatically convert every hydration increase into a positive learning signal.

Likewise, repeated failed commands, drinking at full hydration, refilling an already-full flask, and repeatedly visiting the same location must not generate unlimited progress credit.

Any exploration incentive should be bounded and subordinate to urgent survival needs.

Explain how feedback influences the controller’s choices, candidate-skill validation, or retrieval ranking. Do not create a score that is logged but never used.

Recognize that the NPC might still become dependent on rescue. Measure and report that behavior rather than declaring success because it remains alive.

11. REAL-TIME OPERATION AND MODEL INTEGRATION

Keep movement, collisions, depletion, and active procedure execution in the simulation loop.

Do not call a language model every frame or for every footstep.

Request decisions at meaningful events, such as a new observation, completed procedure, important condition change, unexpected failure, or recovery from collapse.

Keep the game responsive while inference is pending. Reject stale responses when their assumptions or targets are no longer valid.

Provide configurable call limits, timeouts, action budgets, and retry limits.

Distinguish model-service failures from gameplay failures in logs and evaluation. An API timeout is not evidence that a water-gathering skill is intrinsically incorrect.

Keep simulation and persistence local where practical. Do not require rented cloud GPUs.

Use a replaceable model-provider interface supporting a configurable local endpoint and, optionally, hosted inference. Protect credentials appropriately for the runtime.

A deterministic mock provider is acceptable for automated integration tests, but label it clearly. Do not present scripted mock behavior as learned behavior.

If live inference cannot be tested because no model is configured, report that limitation explicitly and provide exact setup instructions.

Do not execute arbitrary model-generated host code. Learned procedures must use a restricted action format with approved operations and bounded execution.

12. INSPECTION AND TESTING

Provide an NPC inspection panel showing:
- Hydration, flask contents, and lifecycle state.
- Current action or selected skill.
- Discovered water sources.
- Recent outcomes and compact decision summaries.
- Candidate and validated skills.
- Collapse/rescue counts and the last rescuer.

Visually distinguish normal drinking from rescue. Allow the developer to inspect the evidence supporting a learned skill or belief.

Add automated tests covering hydration timing, collection versus drinking, invalid interactions, collapse, action cancellation, rescue provenance, repeated callbacks, and persistence across restart.

Test that revival retains memories and skills and does not become fast travel.

Test blocked routes and unavailable sources. The NPC must receive failure feedback and be able to revise its behavior.

Provide a repeatable evaluation mode using matched world seeds, model configuration, and elapsed simulation time.

Compare:
A. Persistent memory and skill learning enabled.
B. The same controller with persistent learning disabled.

Measure independent collection-and-drinking successes, collapses, rescues, repeated invalid actions, time to obtain water, and transfer to changed starting conditions.

Use multiple trials. Do not promise that every successive attempt will improve.

Report honestly whether persistent learning improved behavior. A populated diary or a single lucky success is insufficient evidence.

DELIVERABLES

Deliver working code, an example configuration, tests, a short architecture note, and exact instructions to run the game and inspect the NPC.

Document which abilities are supplied infrastructure and which procedures were actually acquired during testing.

Summarize what works, what was tested, what requires a configured model, and any unresolved issues.

The central acceptance scenario is:

A single persistent NPC explores without preloaded source coordinates, attempts to obtain water, and records the outcomes. If it fails and dehydrates, it collapses. Gods or the player provide rescue water. It wakes as the same character, retains its experience, and uses that experience in subsequent decisions.

Success means demonstrating experience-dependent improvement toward independent water gathering—not merely keeping the NPC alive through repeated rescue.