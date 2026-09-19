import Fastify from "fastify";

import { registerRoutes } from "./routes.js";

const app = Fastify({ logger: true });
registerRoutes(app);

const port = Number(process.env.PORT ?? 4117);
const host = process.env.HOST ?? "0.0.0.0";

const banner = String.raw`
     _    ___   ____
    / \  |_ _| |  _ \ _ __ _____  ___   _
   / _ \  | |  | |_) | '__/ _ \ \/ / | | |
  / ___ \ | |  |  __/| | | (_) >  <| |_| |
 /_/   \_\___| |_|   |_|  \___/_/\_\\__, |
                                      |___/

             A I   P R O X Y
        simple tech. massive possibilities.
`;

try {
  await app.listen({ port, host });

  console.log(banner);
  console.log("  ● AP is broadcasting");
  console.log(`  → http://localhost:${port}`);
  console.log(`  → health: http://localhost:${port}/health\n`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
