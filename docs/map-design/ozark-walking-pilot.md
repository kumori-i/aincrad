# Bounded Ozark walking pilot

This pilot is an opt-in, fresh, **unsaved** walking session over one dry corridor of the approved Ozark landform. It uses the authored continuous sampler through a new `ozark-walking-pilot-v1` identity. The existing offline preview remains nonplayable, and ordinary startup still selects the historical valley.

## Entry and isolation

The desktop accepts the pilot only with `--test --test-profile=<disposable directory> --test-ozark-pilot` in an unpackaged build. This selects the exact `?test=1&ozarkPilot=1` entry route. The route constructs its own in-memory player and clock; it never loads the ordinary game boot, its save manager, NPCs, ecology, or saved world. The pilot displays its unsaved status and discards progress on close. Neither the pilot identity nor the preview identity is accepted by the ordinary `freshState` or save path.

The center of the pilot corridor is part of the same 400-pixel-cell coordinate transform as the approved 96 by 72 Ozark descriptor. The walking rectangle is x = -1500..600 and y = -900..900 logical pixels. The fixed spawn is (-680, 380), with a ten-pixel actor radius and a checked dry route eastward to x = 0. Every movement step checks the actor's swept footprint against sampled water, the internal pond, corridor bounds, and local terrain grade. Axis sliding uses those same checks. The sampled sinkhole pond lies outside this short corridor; it is classified as a hazard, but this trial does not offer a route to it.

The grade rule is provisional and local to this experiment: the largest four-direction height change at an actor-sized probe must be at most 0.03 *relative height units per logical pixel*. The approved spawn-to-east route measures about 0.021, while a dry northwest patch near (-1450, -850) measures about 0.039. These are sampler units, not surveyed slopes or a general climbing skill. The line-of-sight check samples the same elevation field against a three-unit eye height. Local observations expose qualitative ground and habitat within visible pilot bounds, without hidden sampler numbers.

The browser constructor checks the fixed descriptor seed and dimensions but does not recompute its SHA-256 digest at runtime. The required `ozark-preview-pixels` test regenerates the same source descriptor and pins its sampler-relevant digest; the pilot test pins the separate policy identity. A source or policy change requires those tests to pass with a reviewed new identity before publication.

The renderer colors each terrain tile from this pilot's own sampled landform, using the same coordinate transform as collision and sight. Dry pixels blocked by the pilot grade policy receive a striped rock cue from the same classifier. It draws the player and no legacy valley objects. Drawn water is a **temporary walking barrier for this trial**. The eventual physical design still needs crossing, current drift, wetness, and learned swimming, without prebuilt bridges. This pilot has no physical swimming, autonomous agents, caves, food, ecology, or persistent full-map play.

## Verification

Focused tests check the identity gate, radius-aware spawn and dry route, water and pond contact, boundaries and excessive grade, swept movement, sight/observation behavior, renderer sampling, and pilot entry isolation. `npm run check` and `npm run build` verify the repository. `node scripts/verify-ozark-pilot-desktop.mjs` launches the real Electron application in a disposable test profile, sends native movement input, captures a rendered screenshot in `test-results/ozark-pilot-desktop/`, asserts zero pilot storage writes, and checks exact legacy save bytes after closing and reopening the profile. No pilot run should use a live profile or saved world.
