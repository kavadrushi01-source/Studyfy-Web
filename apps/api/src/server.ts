import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import { initRealtime } from "./realtime/server.js";

const PORT = Number(process.env.PORT ?? 4000);

const app = createApp();
// Plain HTTP server (not app.listen) so Socket.io can attach (§12.5).
const server = createServer(app);
initRealtime(server);

server.listen(PORT, () => {
  console.log(`@studyfy/api listening on http://localhost:${PORT}`);
});

function shutdown(signal: NodeJS.Signals): void {
  console.log(`Received ${signal}, shutting down gracefully...`);
  // Stop taking new work, drain connections, release the DB pool, then exit.
  server.close(() => {
    prisma
      .$disconnect()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });
  // Force-exit if connections hang (Render free-tier friendly).
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
