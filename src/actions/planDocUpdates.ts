import { createAction } from "spinai";
import type { SpinAiContext } from "spinai";
import type {
  ReviewState,
  CodeAnalysis,
  DocStructure,
  UpdatePlan,
} from "../types";
import OpenAI from "openai";

interface PlanDocUpdatesParams {
  owner: string;
  repo: string;
}

function isPlanDocUpdatesParams(
  params: unknown
): params is PlanDocUpdatesParams {
  return (
    typeof params === "object" &&
    params !== null &&
    typeof (params as any).owner === "string" &&
    typeof (params as any).repo === "string"
  );
}

async function generateUpdatePlan(
  openai: OpenAI,
  codeAnalysis: CodeAnalysis,
  docStructure: DocStructure,
  config: ReviewState["config"]
): Promise<UpdatePlan> {
  // Use LLM to analyze changes and plan documentation updates
  const response = await openai.chat.completions.create({
    model: "gpt-4-turbo-preview",
    messages: [
      {
        role: "system" as const,
        content: `You are a documentation planning expert. Your task is to analyze code changes and the existing documentation structure to plan necessary documentation updates.

Key principles:
1. Focus on user value - what would developers need to know?
2. Respect existing documentation structure and organization
3. Prioritize updates based on significance and impact
4. Consider relationships between documents
5. Plan navigation changes to maintain good organization

Consider these factors when planning:
- New features or APIs need comprehensive documentation
- Significant changes to existing features need doc updates
- Related documents may need cross-reference updates
- Overview/index files need updates for significant changes
- Navigation structure should reflect content organization

Return a detailed plan as a JSON object with this structure:
{
  "summary": "Brief overview of planned changes",
  "updates": [{
    "path": "relative/path/to/doc.mdx",
    "type": "create" | "update",
    "reason": "Explanation of why this update is needed",
    "priority": "high" | "medium" | "low",
    "sourceFiles": ["related/code/files"],
    "relatedDocs": ["other/docs/to/update"],
    "suggestedContent": {
      "title": "Suggested title for new files",
      "sections": ["Key sections to include"],
      "examples": ["Suggested code examples"]
    }
  }],
  "navigationChanges": [{
    "group": "Group name",
    "changes": [{
      "type": "add" | "move" | "remove",
      "page": "page/path"
    }]
  }]
}`,
      },
      {
        role: "user" as const,
        content: `Here is the current state to analyze:

Code Changes Summary:
${codeAnalysis.summary}

Impacted Areas: ${codeAnalysis.impactedAreas.join(", ")}
Significant Changes: ${codeAnalysis.significantChanges}

Changed Files:
${codeAnalysis.changes
  .map(
    (change) => `
- ${change.file} (${change.type})
  Category: ${change.category}
  Significance: ${JSON.stringify(change.significance)}
  Related Files: ${change.relatedFiles?.join(", ") || "none"}
`
  )
  .join("\n")}

Documentation Structure:
Categories: ${docStructure.categories.join(", ")}

File Tree:
${docStructure.fileTree}

Current Navigation:
${JSON.stringify(docStructure.navigation, null, 2)}

Configuration:
Doc Extensions: ${config.matchRules?.docExtensions?.join(", ") || ".mdx"}
Path Mappings: ${JSON.stringify(config.matchRules?.pathMappings || {})}

Please analyze this information and provide a detailed plan for documentation updates.`,
      },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  const plan = JSON.parse(response.choices[0]?.message?.content || "{}");

  // Validate and clean up the plan
  return {
    summary: plan.summary || "No summary provided",
    updates: (plan.updates || []).map((update: any) => ({
      path: update.path,
      type: update.type || "update",
      reason: update.reason || "Update needed based on code changes",
      priority: update.priority || "medium",
      sourceFiles: update.sourceFiles || [],
      relatedDocs: update.relatedDocs || [],
      suggestedContent: update.suggestedContent || undefined,
    })),
    navigationChanges: plan.navigationChanges || [],
  };
}

export const planDocUpdates = createAction({
  id: "planDocUpdates",
  description:
    "Plans documentation updates based on code analysis and documentation structure",
  parameters: {
    type: "object",
    properties: {
      owner: { type: "string", description: "Repository owner" },
      repo: { type: "string", description: "Repository name" },
    },
    required: ["owner", "repo"],
  },
  async run(
    context: SpinAiContext,
    parameters?: Record<string, unknown>
  ): Promise<SpinAiContext> {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }
    if (!parameters || !isPlanDocUpdatesParams(parameters)) {
      throw new Error("Invalid parameters provided");
    }

    const state = context.state as ReviewState;

    if (!state.codeAnalysis) {
      throw new Error(
        "Code analysis must be performed before planning updates"
      );
    }
    if (!state.docStructure) {
      throw new Error(
        "Documentation structure must be analyzed before planning updates"
      );
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    console.log("\n=== Planning Documentation Updates ===");

    // Generate the update plan
    const plan = await generateUpdatePlan(
      openai,
      state.codeAnalysis,
      state.docStructure,
      state.config
    );

    // Store plan in state
    state.updatePlan = plan;

    // Log the plan
    console.log("\nUpdate Plan Summary:", plan.summary);
    console.log("\nPlanned Updates:");
    plan.updates.forEach((update) => {
      console.log(
        `\n${update.type === "create" ? "Create" : "Update"}: ${update.path}`
      );
      console.log(`Priority: ${update.priority}`);
      console.log(`Reason: ${update.reason}`);
      if (update.suggestedContent) {
        console.log(
          "Suggested Content:",
          JSON.stringify(update.suggestedContent, null, 2)
        );
      }
    });

    if (plan.navigationChanges?.length) {
      console.log("\nNavigation Changes:");
      plan.navigationChanges.forEach((change) => {
        console.log(`\nGroup: ${change.group}`);
        change.changes.forEach((c) => {
          console.log(`- ${c.type}: ${c.page}`);
        });
      });
    }

    return context;
  },
});
