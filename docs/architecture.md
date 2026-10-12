# Aincrad architecture

## Runtime

The browser or Electron loads the same game. The source consists of plain ES modules; a small project-specific bundler can embed them and the stylesheet in `play.html` with hash-based Content Security Policy. There is no CDN, remote API, model, or runtime data download.

The renderer is Canvas 2D, not Phaser, Godot, or a 3D engine. This keeps the initial world independently runnable and dependency-free. The optional Electron wrapper supplies only a window and a stable local origin; the game renderer has no Node or native-file bridge.

## Authoritative state

World rules live in `world.js`. The state contains a position, scene ID, active elapsed time, distance walked, discovery lists, and waypoint. The world is fixed and generated deterministically from the seed in `config.js`. Moving or zooming the camera never changes geometry. Persistent terrain mutation is not implemented in v0.1.

A 60 Hz fixed-step loop advances only when the game is active and no panel is open. A frame's elapsed time is capped at 250 milliseconds to prevent pathological catch-up after hangs. Wall-clock focus loss and application closure pause; this is deliberately not a server or always-on simulation.

## Scale and traversal

The outer artwork envelope is 48,000 × 48,000 logical pixels. The walkable valley boundary uses a rounded superellipse with a 22,500-pixel half-span. Its central east–west path therefore has a nominal 45,000-pixel crossing at 150 pixels/second: 300 seconds. The avatar's 10-pixel collision radius slightly reduces the reachable span.

The central path, additional bridge paths, and cave approach trails exclude tree generation. Terrain generation and collision share the same analytic water, ridge, and path functions. A true movement test starts at x=-22,480 and walks east for 18,000 fixed steps, checking that it reaches the opposite edge. Other routes naturally differ in length.

All movement is normalized and subdivided into short steps to avoid tunneling. X/Y collision resolution permits sliding. World boundaries, water, tree bases, rocks, cave walls and cave formations are solid; decorative camp furniture and foliage are not complete physics objects.

## Rendering and performance

Terrain is generated on demand in 640-pixel chunks. The least-recently-used cache is bounded to 48 chunks. Logical terrain rasterization, object placement, collision, and full-map generation share deterministic functions. Only objects near the camera are drawn; the entire valley is not instantiated as millions of game objects.

Actors and scenery are sorted by ground Y for top-down occlusion. Tree foliage becomes translucent when it would hide the player. Wave motion, butterflies, fire, smoke and crystal particles are cosmetic. Cave darkness is a screen-space gradient around the player, not a visibility/stealth simulation.

The map uses an intentionally exaggerated trail drawing. Waypoints report approximate straight-line walking time, not a computed collision-free route.

## Caves

All three outdoor entrances have distinct IDs and return coordinates. Each enters the same first-generation chamber layout with its own crystal palette. The interior is a union of elliptical rooms and connecting corridors. Stalagmites and crystals avoid the central corridor bands. A graph search test verifies that every room is reachable from the entrance.

A separate scene ID selects cave collision, art, lighting and minimap. Pressing E near the stairs returns to the current cave's outdoor entrance. Position and current scene are saved together.

## Saving

`save.js` validates version, scene, finite coordinates, reachability, finite bounded counters and known IDs. Reads do not silently delete corrupt data. Automatic saving is withheld after an unreadable/incompatible save until an explicit save or new expedition. Storage errors surface in the interface.

The browser and Electron store saves in their own localStorage origins. In browser mode the origin includes the port. A raw file URL may have browser-dependent storage restrictions; the loopback server or desktop mode is preferable for ongoing play.

## Future extension points

Add typed, validated game actions (gather, plant, water, harvest, place structure) beside `moveActor`. Add an inventory and mutable world layer to persistent state before adding NPCs. A human controller and a future NPC controller should submit the same actions. Models, if introduced, choose goals or bounded actions; the simulation alone checks preconditions and changes inventories and terrain. Models must not run code, modify the project, or invent completed actions through dialogue.
