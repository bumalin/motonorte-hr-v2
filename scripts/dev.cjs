/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS launcher by design */
// Starts `next dev` from the project root, whatever the caller's working directory (used by the preview pane).
process.chdir(require("node:path").join(__dirname, ".."));
process.argv.push("dev", "-H", "127.0.0.1"); // this PC only, never the office network (security report M-1)
require("../node_modules/next/dist/bin/next");
