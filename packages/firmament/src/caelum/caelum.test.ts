// caelum.test.ts — the loader + boot-time graph validation + collision/portal helpers. The valid cases build
// throwaway fixture dirs under os.tmpdir(); one case loads the REAL shipped content (config/world.json +
// content/zones/*) to prove the topology we ship actually validates. No DB, no Nest — pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorldRegistry, isWalkable, portalAt, tileAt } from "./caelum.js";

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

test("collision: a box tile is blocked, a floor tile is walkable, out-of-bounds is blocked", () => {
  withFixture({}, (root) => {
    const map = loadWorldRegistry(root).requireZone("genesis").map;
    assert.equal(isWalkable(map, 16, 16), true); // tile (0,0) floor
    assert.equal(isWalkable(map, 40, 40), false); // tile (1,1) box
    assert.equal(isWalkable(map, -1, 10), false); // left of the grid
    assert.equal(isWalkable(map, 999, 10), false); // right of the grid
    assert.deepEqual(tileAt(map, 40, 40), { tx: 1, ty: 1 });
  });
});

test("portalAt: returns the portal only when standing on its trigger tile", () => {
  withFixture({}, (root) => {
    const map = loadWorldRegistry(root).requireZone("genesis").map;
    assert.equal(portalAt(map, 16, 16), undefined); // not a portal tile
    const p = portalAt(map, 3 * 32 + 10, 2 * 32 + 10); // on tile (3,2)
    assert.ok(p);
    assert.deepEqual(p.to, { zoneId: "verdant", spawn: "default" });
  });
});

test("boot fails when a portal targets an unknown zone", () => {
  withFixture(
    { genesisMap: grid({ portals: [{ at: { x: 3, y: 2 }, to: { zoneId: "nowhere", spawn: "default" } }] }) },
    (root) => assert.throws(() => loadWorldRegistry(root), /unknown zone "nowhere"/),
  );
});

test("boot fails when a portal targets a spawn the zone does not define", () => {
  withFixture(
    { genesisMap: grid({ portals: [{ at: { x: 3, y: 2 }, to: { zoneId: "verdant", spawn: "ghost" } }] }) },
    (root) => assert.throws(() => loadWorldRegistry(root), /spawn "ghost" which does not exist/),
  );
});

test('boot fails when a zone map has no "default" spawn', () => {
  withFixture({ genesisMap: grid({ spawns: { start: { x: 16, y: 16 } } }) }, (root) =>
    assert.throws(() => loadWorldRegistry(root), /no "default" spawn/),
  );
});

test("boot fails when a world's startingZoneId is not in its zone list", () => {
  withFixture(
    { manifest: { defaultWorldId: "celestia", worlds: { celestia: { name: "C", startingZoneId: "ghost", zones: ["genesis", "verdant"] } } } },
    (root) => assert.throws(() => loadWorldRegistry(root), /startingZoneId "ghost" is not in its zone list/),
  );
});

test("boot fails when the tile grid dimensions disagree with width/height", () => {
  withFixture({ genesisMap: grid({ tiles: [[0, 0, 0, 0], [0, 1, 0, 0]] }) }, (root) =>
    assert.throws(() => loadWorldRegistry(root), /expected height 3/),
  );
});

test("boot fails when a zone bundle declares a mismatched id", () => {
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

test("the real shipped content/ topology validates", () => {
  const reg = loadWorldRegistry(); // default root = repo root
  const genesis = reg.requireZone(reg.startingZoneId());
  assert.ok(genesis.map.spawns.default, "starting zone has a default spawn");
  // The shipped genesis map has a box at tile (3,1); it must read as blocked.
  assert.equal(isWalkable(genesis.map, 3 * genesis.map.tileSize + 1, 1 * genesis.map.tileSize + 1), false);
});
