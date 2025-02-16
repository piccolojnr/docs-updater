import * as dotenv from "dotenv";
import { createAgent, createOpenAILLM } from "spinai";
import { DocConfig, ReviewState } from "./types";
import { createFullConfig } from "./config";
import { actions } from "./actions";
import { startServer } from "./server";
import { initialDocumentationActions } from "./actions/initialDocsActions";

dotenv.config();

export interface CreateDocUpdateAgentOptions {
  config?: Partial<DocConfig>;
  openAiKey?: string;
  githubToken?: string;
  port?: number;
}

export function createDocUpdateAgent(
  options: CreateDocUpdateAgentOptions = {}
) {
  const config = createFullConfig(options.config || {});

  // Validate required credentials
  const openAiKey = options.openAiKey || process.env.OPENAI_API_KEY;
  const githubToken = options.githubToken || process.env.GITHUB_TOKEN;
  if (!openAiKey) throw new Error("OpenAI API key is required");
  if (!githubToken) throw new Error("GitHub token is required");

  // Create the agent
  const agent = createAgent<ReviewState>({
    instructions: `You are a documentation maintenance agent that helps keep documentation in sync with code changes.
    When code changes are made in a pull request, you:
    1. Analyze the code changes to understand what functionality has changed
    2. Analyze the existing documentation structure and relationships
    3. Plan necessary documentation updates based on the changes
    4. Generate precise, accurate documentation updates
    5. Update navigation structure in mint.json as needed
    6. ${config.prConfig.updateOriginalPr ? "Update the original PR" : "Create a new PR"} with the documentation updates`,
    actions,
    llm: createOpenAILLM({
      apiKey: openAiKey,
      model: "gpt-4-turbo-preview",
    }),
    agentId: "mintlify-update-agent",
    // Optional: Enable SpinAI monitoring
    // spinApiKey: process.env.SPINAI_API_KEY,
  });

  return agent;
}


export interface CreateInitialDocsAgentOptions {
  config?: Partial<DocConfig>;
  openAiKey?: string;
  githubToken?: string;
  port?: number;
}
export function createInitialDocsAgent(
  options: CreateInitialDocsAgentOptions = {}
) {
  // Validate required credentials
  const openAiKey = options.openAiKey || process.env.OPENAI_API_KEY;
  const githubToken = options.githubToken || process.env.GITHUB_TOKEN;
  if (!openAiKey) throw new Error("OpenAI API key is required");
  if (!githubToken) throw new Error("GitHub token is required");

  // Create the agent
  const agent = createAgent<ReviewState>({
    instructions: `You are an initial documentation generation agent that creates baseline documentation for repositories.
When triggered, you:
1. Analyze the repository to identify key files that need documentation.
2. Plan initial documentation updates for each identified file.
3. Generate concise, accurate MDX documentation for each file.
4. Save the generated documentation in the docs/ folder.
5. Create a pull request with the new documentation.`,
    actions: initialDocumentationActions,
    llm: createOpenAILLM({
      apiKey: openAiKey,
      model: "gpt-4-turbo-preview",
    }),
    agentId: "initial-docs-agent",
  });

  return agent;
}

export { startServer } from "./server";
export type { DocConfig } from "./types";
export type { ServerOptions } from "./server";

// Start the server when this file is run directly
if (require.main === module) {
  startServer().catch((error: Error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}
