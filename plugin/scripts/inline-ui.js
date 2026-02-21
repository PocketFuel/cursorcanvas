#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..");
const htmlPath = path.join(dir, "figma-design-ui.html");
const jsPath = path.join(dir, "dist", "ui.js");
const outPath = path.join(dir, "dist", "figma-design-ui.html");

let html = fs.readFileSync(htmlPath, "utf8");
let js = fs.readFileSync(jsPath, "utf8");
js = js.replace(/<\/script>/gi, "<\\/script>");
html = html.replace(
  '<script src="./dist/ui.js"></script>',
  "<script>\n" + js + "\n</script>"
);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log("Inlined UI script into dist/figma-design-ui.html");
