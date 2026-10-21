// pictor/backend.ts — the swappable render seam. A RenderBackend is the ONLY per-engine code (Pixi, Phaser, a
// Godot GDScript equivalent). The Orchestrator computes a VisualSpec per entity (backend-agnostic data — no
// engine types), and the backend just draws it: a box by default, the requested sprite when it's loaded.
import type { TilesetManifest, ZoneMapWire } from "@celestia/jupiter";

export type Facing = "down" | "up" | "right" | "left";

/** Everything a backend needs to draw ONE entity this frame, computed by the Orchestrator from entity data.
 *  Backend-agnostic. The backend shows `sprite` if it's loaded; otherwise it draws `box` (always valid). */
export type VisualSpec = {
  kind: string;
  x: number;
  y: number;
  z: number; // depth key (= y); nearer-the-bottom draws in front
  box: { color: number; size: number; alpha: number }; // the always-available fallback view
  label: { text: string; color: string };
  bar?: { frac: number; alpha: number }; // HP bar (mobs)
  sprite?: { id: string; anim: string; flip: boolean }; // requested sprite (may not be loaded yet)
  useSprite: boolean; // orchestrator intent: sprite mode on + a mapping exists + alive
};

/** The one per-engine surface. `H` is an opaque per-entity view handle the backend owns and hands back. */
export interface RenderBackend<H = unknown> {
  init(): Promise<void>;
  setAssets(base: string, tileset?: TilesetManifest): void; // art root (dev path/CDN) + optional ground tileset
  setMap(map: ZoneMapWire): void; // called AFTER setAssets, so the backend already knows the tileset to draw
  camera(x: number, y: number, zoom: number): void; // world→screen offset (px) + uniform world scale (zoom)
  setHud(text: string): void;
  spawn(id: string, spec: VisualSpec): H;
  update(handle: H, spec: VisualSpec): void;
  despawn(handle: H): void;
}
