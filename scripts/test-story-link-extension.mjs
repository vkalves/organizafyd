import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const dir = new URL("../extensions/storys-com-link/", import.meta.url);
const read = (name) => readFile(new URL(name, dir), "utf8");
const manifest = JSON.parse(await read("manifest.json"));
assert.equal(manifest.version, "0.8.1");
assert.deepEqual(manifest.permissions, []);
for (const field of [
  "host_permissions",
  "optional_permissions",
  "optional_host_permissions",
  "content_scripts",
  "externally_connectable",
])
  assert.ok(!(field in manifest), `Unexpected capability: ${field}`);
assert.match(
  manifest.content_security_policy.extension_pages,
  /connect-src 'none'/,
);
assert.match(
  manifest.content_security_policy.extension_pages,
  /script-src 'self'/,
);
assert.doesNotMatch(
  manifest.content_security_policy.extension_pages,
  /unsafe-/,
);
const worker = await read("background.js");
let clicked;
const tabs = [];
vm.runInNewContext(worker, {
  chrome: {
    action: {
      onClicked: {
        addListener(fn) {
          assert.equal(clicked, undefined);
          clicked = fn;
        },
      },
    },
    runtime: { getURL: (path) => "chrome-extension://test/" + path },
    tabs: { create: (options) => tabs.push(options.url) },
  },
});
assert.equal(typeof clicked, "function");
clicked();
assert.deepEqual(tabs, ["chrome-extension://test/editor.html"]);
const editor = await read("editor.js");
for (const source of [worker, editor])
  assert.doesNotMatch(
    source,
    /chrome\.(cookies|scripting|declarativeNetRequest)|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|document\.cookie|onMessage|configure_to_story|rupload_igphoto|ANDROID_UA/,
  );
const html = await read("editor.html");
assert.doesNotMatch(html, /<script[^>]+src=["']https?:/);
assert.match(html, /Adesivos → Link/);
assert.match(html, /não faz parte da imagem baixada/);
const instructions = await read("LEIA-ME.txt");
assert.match(instructions, /Remova a extensão antiga/);
assert.match(instructions, /não interrompe a versão antiga/);
console.log(
  "PASS: extension has no account/session/network privileges; action opens only its local editor; no publishing bridge or private Instagram calls remain",
);
