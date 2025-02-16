import { Context } from "hono";
import { createFullConfig } from "./config";
import { ReviewState } from "./actions/initialDocsActions/types";


type Agent = any;

export async function generateInitialDocs(c: Context, agent: Agent) {
  try {
    const body = await c.req.json();

    if (!body.repository || !body.repository.owner?.login || !body.repository.name) {
      return c.json({ error: "Missing repository information" }, 400);
    }

    // Create the initial state with proper config
    const config = createFullConfig(body.config || {});

    const state: ReviewState = {
      owner: body.repository.owner.login,
      repo: body.repository.name,
      config,
    };

    console.log(`📢 Starting initial documentation for ${state.owner}/${state.repo}`);


    // Create and execute the agent
    const result = await agent({
      input: "Generate initial documentation for the repository",
      externalCustomerId: state.owner,
      state,
    });

    if (result.state.pullRequestUrl) {
      return c.json({
        message: "Initial documentation PR created successfully!",
        pullRequestUrl: result.state.pullRequestUrl,
      });
    } else {
      return c.json({
        message: "Initial documentation process completed, but no PR was created.",
      });
    }
  } catch (error) {
    console.error("❌ Error generating initial docs:", error);
    return c.json(
      { error: "Failed to generate initial documentation", details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
};

