import { defineConfig, type Plugin } from "vite";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// DEV-ONLY: serve the game's assets (content/assets) at /assets so the client can fetch the sprites/tilesets the
// SERVER's manifest points at (base "/assets"). Identical to pyxis's dev middleware — both web clients fetch the
// same server-driven assets. In prod these come from a CDN (+ the parked encryption), not this middleware.
const ASSET_ROOT = fileURLToPath(new URL("../../content/assets", import.meta.url));

function contentTypeFor(file: string): string {
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".mp3")) return "audio/mpeg";
  if (file.endsWith(".ogg")) return "audio/ogg";
  return "application/octet-stream";
}

function assetServer(): Plugin {
  return {
    name: "celestia-assets",
    configureServer(server) {
      // Mounted at /assets → Connect strips the prefix, so req.url is the path beneath it.
      server.middlewares.use("/assets", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
        const file = join(ASSET_ROOT, rel);
        if (!file.startsWith(ASSET_ROOT)) {
          // path traversal attempt → refuse
          res.statusCode = 403;
          res.end();
          return;
        }
        stat(file)
          .then((s) => {
            if (!s.isFile()) return next();
            res.setHeader("content-type", contentTypeFor(file));
            createReadStream(file).pipe(res);
          })
          .catch(() => next());
      });
    },
  };
}

export default defineConfig({
  server: { port: 5173 }, // 5174 is Pyxis; Phaethon runs alongside it
  plugins: [assetServer()],
});
