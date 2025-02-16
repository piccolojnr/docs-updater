import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createDocUpdateAgent, createInitialDocsAgent }
  from "./index";
import { handleWebhook } from "./webhooks";
import type { DocConfig } from "./types";
import { generateInitialDocs } from "./route";

export interface ServerOptions {
  config?: Partial<DocConfig>;
  openAiKey?: string;
  githubToken?: string;
  port?: number;
}

export async function startServer(options: ServerOptions = {}) {
  const pullAgent = createDocUpdateAgent(options);
  const initialAgent = createInitialDocsAgent(options);
  const app = new Hono();

  // Single webhook endpoint
  app.post("/webhook", (c) => handleWebhook(c, pullAgent));

  // Initial documentation generation endpoint

  app.post("/generate-initial-docs", (c) => generateInitialDocs(c, initialAgent));

  // test api
  app.get("/test", (c) => {
    return c.json({ message: "Hello from Hono" });
  });

  // Start server
  const port = options.port || parseInt(process.env.PORT || "3000", 10);
  const server = serve({
    fetch: app.fetch,
    port,
  });

  console.log(`🚀 Server running at http://localhost:${port}`);

  // Return both the agent and server instance
  return {
    agent: pullAgent,
    server
  };
}
