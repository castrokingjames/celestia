// @celestia/pictor — the Painter's Easel: the shared, framework-agnostic client render orchestrator. A renderer
// supplies a RenderBackend (draw primitives only); Pictor owns the rest (id-diff, camera, HUD, facing/animation,
// the per-entity VisualSpec). pyxis + phaethon share this; a Godot GDScript backend mirrors the same contract.
export * from "./backend.js";
export * from "./orchestrator.js";
export * from "./sprite-descriptor.js";
