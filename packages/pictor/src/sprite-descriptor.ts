// pictor/sprite-descriptor.ts — the generic (engine-agnostic) half of sprite loading: fetch + normalize the sheet
// descriptor (a directional grid — animations are rows, frames are columns). Each backend calls this, then loads
// the image + slices it into ITS own frame type (Pixi Texture / Phaser frames). The fetch is shared; the pixels
// are per-engine.
export type SpriteDescriptor = {
  frameW: number;
  frameH: number;
  offsetX: number;
  offsetY: number;
  animations: Record<string, { row: number; length: number }>;
};

type Raw = {
  width: number;
  height: number;
  offset_x?: number;
  offset_y?: number;
  animations: Record<string, { row: number; length: number }>;
};

/** Fetch `${base}/sprites/${id}.json` → a normalized descriptor, or null on any failure (caller keeps the box). */
export async function loadSpriteDescriptor(base: string, id: string): Promise<SpriteDescriptor | null> {
  try {
    const res = await fetch(`${base}/sprites/${id}.json`);
    if (!res.ok) return null;
    const d = (await res.json()) as Raw;
    return { frameW: d.width, frameH: d.height, offsetX: d.offset_x ?? 0, offsetY: d.offset_y ?? 0, animations: d.animations };
  } catch {
    return null;
  }
}
