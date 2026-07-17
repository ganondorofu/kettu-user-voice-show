import { transformSync } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Kettu's legacy single-plugin installer (src/core/vendetta/plugins.ts) fetches
// `<repoUrl>/manifest.json` and `<repoUrl>/index.js`, then evaluates the JS as:
//   vendetta => { return <index.js content> }
// so index.js must be a single JS *expression*, not statements. We transpile
// our TS source and wrap it as an IIFE expression that closes over `vendetta`.
const body = readFileSync("index.ts", "utf8");

const { code } = transformSync(body, {
    loader: "ts",
    minify: true,
    target: "esnext",
});

const iife = `(function(vendetta){${code}return{onLoad:onLoad,onUnload:onUnload};})(vendetta)`;
writeFileSync("index.js", iife);

const hash = createHash("sha256").update(iife, "utf8").digest("hex").toUpperCase();
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.hash = hash;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

console.log(`Built index.js (${iife.length} bytes), hash ${hash}`);
