/** Compile typed source instead of concatenating JS strings. Never embeds runtime env values. */
import { build } from "esbuild";
import {
  readFile,
  writeFile,
  mkdir,
  rm,
  readdir,
  copyFile,
} from "node:fs/promises";
const root = new URL("../", import.meta.url);
await rm(new URL("dist", root), { recursive: true, force: true });
await mkdir(new URL("dist/client/assets/", root), { recursive: true });
await mkdir(new URL("dist/server/", root), { recursive: true });
await mkdir(new URL("dist/.openai/", root), { recursive: true });
await build({
  entryPoints: [new URL("src/client/main.tsx", root).pathname],
  outfile: new URL("dist/client/assets/app.js", root).pathname,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
const html = (await readFile(new URL("index.html", root), "utf8")).replace(
  '<script type="module" src="/src/client/main.tsx"></script>',
  '<link rel="stylesheet" href="/assets/app.css"/><script type="module" src="/assets/app.js"></script>',
);
await writeFile(new URL("dist/client/index.html", root), html);
const assets = {
  "/": { body: html, type: "text/html; charset=utf-8" },
  "/index.html": { body: html, type: "text/html; charset=utf-8" },
};
for (const name of await readdir(new URL("dist/client/assets/", root)))
  assets["/assets/" + name] = {
    body: await readFile(new URL("dist/client/assets/" + name, root), "utf8"),
    type: name.endsWith(".css")
      ? "text/css; charset=utf-8"
      : "text/javascript; charset=utf-8",
  };
await build({
  entryPoints: [new URL("src/server/worker.ts", root).pathname],
  outfile: new URL("dist/server/index.js", root).pathname,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  plugins: [
    {
      name: "browser-assets",
      setup(builder) {
        builder.onResolve({ filter: /^virtual:assets$/ }, () => ({
          path: "assets",
          namespace: "generated",
        }));
        builder.onLoad({ filter: /.*/, namespace: "generated" }, () => ({
          contents: JSON.stringify(assets),
          loader: "json",
        }));
      },
    },
  ],
});
await copyFile(
  new URL(".openai/hosting.json", root),
  new URL("dist/.openai/hosting.json", root),
);
console.log("Built React client and TypeScript Worker in dist/");
