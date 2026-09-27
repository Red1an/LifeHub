#!/usr/bin/env node
// Сервер написан на TypeScript и запускается напрямую (Node ≥ 22.18 умеет убирать типы).
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name === "ExperimentalWarning") return;
  console.warn(w);
});
const { main } = await import("../server/cli.ts");
await main(process.argv.slice(2));
