// caelum.test.ts — the loader + boot-time graph validation + collision/portal helpers. The valid cases build
// throwaway fixture dirs under os.tmpdir(); one case loads the REAL shipped content (config/world.json +
// content/zones/*) to prove the topology we ship actually validates. No DB, no Nest — pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorldRegistry, isWalkable, portalAt, tileAt, RESPAWN_DEFAULTS } from "./caelum.js";

function grid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    width: 4,
    height: 3,
    tileSize: 32,
    tiles: [
      [0, 0, 0, 0],
      [0, 1, 0, 0], // box at tile (1,1)
      [0, 0, 0, 0],
    ],
    spawns: { default: { x: 16, y: 16 } },
    portals: [],
    ...overrides,
  };
}

function writeZone(root: string, id: string, name: string, map: unknown): void {
  const dir = join(root, "content", "zones", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "zone.json"), JSON.stringify({ id, name, tickHz: 20, maxPerChannel: 100, map: "map.json" }));
  writeFileSync(join(dir, "map.json"), JSON.stringify(map));
}

/** A valid two-zone fixture (genesis portals to verdant); callers override one piece to drive a failure. */
function scaffold(opts: { manifest?: unknown; genesisMap?: unknown; verdantMap?: unknown } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "caelum-"));
  const manifest = opts.manifest ?? {
    defaultWorldId: "celestia",
    worlds: { celestia: { name: "Celestia", startingZoneId: "genesis", zones: ["genesis", "verdant"] } },
  };
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(join(root, "config", "world.json"), JSON.stringify(manifest));
  writeZone(root, "genesis", "Genesis", opts.genesisMap ?? grid({ portals: [{ at: { x: 3, y: 2 }, to: { zoneId: "verdant", spawn: "default" } }] }));
  writeZone(root, "verdant", "Verdant", opts.verdantMap ?? grid());
  return root;
}

function withFixture(opts: Parameters<typeof scaffold>[0], fn: (root: string) => void): void {
  const root = scaffold(opts);
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("when the topology is valid, then it loads a registry with every world + zone", () => {
  withFixture({}, (root) => {
    const reg = loadWorldRegistry(root);
    assert.equal(reg.defaultWorldId, "celestia");
    assert.equal(reg.startingZoneId(), "genesis");
    assert.deepEqual([...reg.zones.keys()].sort(), ["genesis", "verdant"]);
    assert.equal(reg.requireZone("genesis").name, "Genesis");
  });
});

test("when isWalkable tests floor, box, and out-of-bounds tiles, then only the floor tile is walkable (collision)", () => {
  withFixture({}, (root) => {
    const map = loadWorldRegistry(root).requireZone("genesis").map;
    assert.equal(isWalkable(map, 16, 16), true); // tile (0,0) floor
    assert.equal(isWalkable(map, 40, 40), false); // tile (1,1) box
    assert.equal(isWalkable(map, -1, 10), false); // left of the grid
    assert.equal(isWalkable(map, 999, 10), false); // right of the grid
    assert.deepEqual(tileAt(map, 40, 40), { tx: 1, ty: 1 });
  });
});

test("when standing on a portal's trigger tile, then portalAt returns the portal (and undefined elsewhere)", () => {
  withFixture({}, (root) => {
    const map = loadWorldRegistry(root).requireZone("genesis").map;
    assert.equal(portalAt(map, 16, 16), undefined); // not a portal tile
    const p = portalAt(map, 3 * 32 + 10, 2 * 32 + 10); // on tile (3,2)
    assert.ok(p);
    assert.deepEqual(p.to, { zoneId: "verdant", spawn: "default" });
  });
});

test("when a portal targets an unknown zone, then boot fails", () => {
  withFixture(
    { genesisMap: grid({ portals: [{ at: { x: 3, y: 2 }, to: { zoneId: "nowhere", spawn: "default" } }] }) },
    (root) => assert.throws(() => loadWorldRegistry(root), /unknown zone "nowhere"/),
  );
});

test("when a portal targets a spawn the zone does not define, then boot fails", () => {
  withFixture(
    { genesisMap: grid({ portals: [{ at: { x: 3, y: 2 }, to: { zoneId: "verdant", spawn: "ghost" } }] }) },
    (root) => assert.throws(() => loadWorldRegistry(root), /spawn "ghost" which does not exist/),
  );
});

test('when a zone map has no "default" spawn, then boot fails', () => {
  withFixture({ genesisMap: grid({ spawns: { start: { x: 16, y: 16 } } }) }, (root) =>
    assert.throws(() => loadWorldRegistry(root), /no "default" spawn/),
  );
});

test("when a world's startingZoneId is not in its zone list, then boot fails", () => {
  withFixture(
    { manifest: { defaultWorldId: "celestia", worlds: { celestia: { name: "C", startingZoneId: "ghost", zones: ["genesis", "verdant"] } } } },
    (root) => assert.throws(() => loadWorldRegistry(root), /startingZoneId "ghost" is not in its zone list/),
  );
});

test("when the tile grid dimensions disagree with width/height, then boot fails", () => {
  withFixture({ genesisMap: grid({ tiles: [[0, 0, 0, 0], [0, 1, 0, 0]] }) }, (root) =>
    assert.throws(() => loadWorldRegistry(root), /expected height 3/),
  );
});

test("when a zone bundle declares a mismatched id, then boot fails", () => {
  const root = scaffold({});
  try {
    writeFileSync(
      join(root, "content", "zones", "genesis", "zone.json"),
      JSON.stringify({ id: "nope", name: "G", tickHz: 20, maxPerChannel: 100, map: "map.json" }),
    );
    assert.throws(() => loadWorldRegistry(root), /mismatched id "nope"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("when a zone spawns a monster kind absent from the roster, then boot fails loudly", () => {
  const root = scaffold({});
  try {
    writeFileSync(
      join(root, "content", "zones", "genesis", "zone.json"),
      JSON.stringify({ id: "genesis", name: "Genesis", tickHz: 20, maxPerChannel: 100, map: "map.json", mobs: [{ kind: "dragon", at: { x: 16, y: 16 } }] }),
    );
    assert.throws(() => loadWorldRegistry(root), /unknown monster kind "dragon"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("when content/mobs.json defines a monster, then its sprite merges into the zone asset manifest", () => {
  const root = scaffold({
    manifest: {
      defaultWorldId: "celestia",
      worlds: { celestia: { name: "C", startingZoneId: "genesis", zones: ["genesis", "verdant"] } },
      assets: { base: "/assets", kinds: { player: "clotharmor" } },
    },
  });
  try {
    writeFileSync(
      join(root, "content", "mobs.json"),
      JSON.stringify({ mobs: { rat: { sprite: "rat", level: 1, maxHp: 8, damage: 1, radius: 8, moveSpeed: 90, aggroRange: 160, attackRange: 40, attackCooldownMs: 1000, decisionIntervalMs: 500, respawnDelayMs: 5000 } } }),
    );
    writeFileSync(
      join(root, "content", "zones", "genesis", "zone.json"),
      JSON.stringify({ id: "genesis", name: "Genesis", tickHz: 20, maxPerChannel: 100, map: "map.json", mobs: [{ kind: "rat", at: { x: 16, y: 16 } }] }),
    );
    const reg = loadWorldRegistry(root);
    assert.equal(reg.mobKind("rat")?.sprite, "rat");
    assert.equal(reg.requireZone("genesis").mobs.length, 1);
    // the client manifest = base kinds (player) + every monster's sprite from the roster
    assert.deepEqual(reg.assetsFor("genesis")?.kinds, { player: "clotharmor", rat: "rat" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("when the manifest sets respawn defaults, then the registry exposes them; else it falls back", () => {
  // absent → fallback
  withFixture({}, (root) => {
    assert.deepEqual(loadWorldRegistry(root).respawn, RESPAWN_DEFAULTS);
  });
  // present → used
  const root = scaffold({
    manifest: {
      defaultWorldId: "celestia",
      worlds: { celestia: { name: "C", startingZoneId: "genesis", zones: ["genesis", "verdant"] } },
      respawn: { scatter: 40, corpseOverlapMs: 120 },
    },
  });
  try {
    assert.deepEqual(loadWorldRegistry(root).respawn, { scatter: 40, corpseOverlapMs: 120 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("when the real shipped content/ topology is loaded, then it validates", () => {
  const reg = loadWorldRegistry(); // default root = repo root
  const genesis = reg.requireZone(reg.startingZoneId());
  assert.ok(genesis.map.spawns.default, "starting zone has a default spawn");
  // The shipped genesis map has a house whose solid body blocks tile (13,12); it must read as blocked.
  assert.equal(isWalkable(genesis.map, 13 * genesis.map.tileSize + 1, 12 * genesis.map.tileSize + 1), false);
  // Monsters are config: the shipped roster + per-zone spawn tables load, and sprites merge into the manifest.
  assert.ok(reg.mobKind("rat"), "rat is in the shipped roster");
  assert.equal(reg.assetsFor(genesis.id)?.kinds.rat, "rat");
});
