import { createAction } from "spinai";
import type { SpinAiContext } from "spinai";
import type { ReviewState, CodeChange, CodeAnalysis } from "../types";
import { Octokit } from "@octokit/rest";
import Groq from "groq-sdk";

interface AnalyzeCodeChangesParams {
  owner: string;
  repo: string;
  pull_number: number;
}

function isAnalyzeCodeChangesParams(
  params: unknown
): params is AnalyzeCodeChangesParams {
  return (
    typeof params === "object" &&
    params !== null &&
    typeof (params as any).owner === "string" &&
    typeof (params as any).repo === "string" &&
    typeof (params as any).pull_number === "number"
  );
}

async function analyzeChanges(
  groq: Groq,
  files: { filename: string; patch?: string; status: string }[]
): Promise<CodeAnalysis> {
  const changes: CodeChange[] = [];
  const impactedAreas = new Set<string>();

  // First pass: Basic analysis of each file
  for (const file of files) {
    const pathParts = file.filename.split("/");
    const category = pathParts[pathParts.length - 2] || "";

    // Basic significance checks
    const significance = {
      hasExports: file.patch?.includes("export ") || false,
      hasInterfaces: file.patch?.includes("interface ") || false,
      hasClasses: file.patch?.includes("class ") || false,
      hasTypes: file.patch?.includes("type ") || false,
      hasEnums: file.patch?.includes("enum ") || false,
      isTest:
        file.filename.includes(".test.") || file.filename.includes(".spec."),
    };

    changes.push({
      file: file.filename,
      patch: file.patch || "",
      type: file.status as "added" | "modified" | "deleted",
      significance,
      category,
    });

    if (category && !significance.isTest) {
      impactedAreas.add(category);
    }
  }

  // Use LLM for deeper analysis
  const response = await groq.chat.completions.create({
    model: process.env.OPENAI_MODEL || "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system" as const,
        content: `You are a code analysis expert. Analyze the following code changes and provide:
1. A brief summary of the changes
2. Identification of impacted areas/categories
3. Assessment of whether these are significant changes (new features, API changes, etc.)
4. Related files that might need documentation updates

Return your analysis as a JSON object with this structure:
{
  "summary": "Brief description of changes",
  "impactedAreas": ["area1", "area2"],
  "significantChanges": boolean,
  "relatedFiles": ["file1", "file2"]
}`,
      },
      {
        role: "user" as const,
        content: `Here are the code changes to analyze:
${changes
            .map(
              (change) => `
File: ${change.file} (${change.type})
Category: ${change.category}
Significance: ${JSON.stringify(change.significance)}
Patch:
\`\`\`diff
${change.patch}
\`\`\`
`
            )
            .join("\n")}`,
      },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  const analysis = JSON.parse(response.choices[0]?.message?.content || "{}");

  // Update changes with related files from analysis
  for (const change of changes) {
    change.relatedFiles = analysis.relatedFiles?.filter(
      (file: string) => file !== change.file
    );
  }

  return {
    changes,
    impactedAreas: Array.from(
      new Set([...impactedAreas, ...(analysis.impactedAreas || [])])
    ),
    significantChanges: analysis.significantChanges || false,
    summary: analysis.summary || "No summary provided",
  };
}

export const analyzeCodeChanges = createAction({
  id: "analyzeCodeChanges",
  description:
    "Analyzes code changes from a PR to determine what documentation needs updating",
  parameters: {
    type: "object",
    properties: {
      owner: { type: "string", description: "Repository owner" },
      repo: { type: "string", description: "Repository name" },
      pull_number: { type: "number", description: "PR number" },
    },
    required: ["owner", "repo", "pull_number"],
  },
  async run(
    context: SpinAiContext,
    parameters?: Record<string, unknown>
  ): Promise<SpinAiContext> {
    if (!process.env.GITHUB_TOKEN) {
      throw new Error("GITHUB_TOKEN environment variable is required");
    }
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }
    if (!parameters || !isAnalyzeCodeChangesParams(parameters)) {
      throw new Error("Invalid parameters provided");
    }

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const openai = new Groq({ apiKey: process.env.OPENAI_API_KEY });

    // Get the PR diff
    const { data: files } = await octokit.pulls.listFiles({
      owner: parameters.owner,
      repo: parameters.repo,
      pull_number: parameters.pull_number,
    });

    // Analyze the changes
    const analysis = await analyzeChanges(openai, files);

    // Store analysis in state
    const state = context.state as ReviewState;
    state.codeAnalysis = analysis;

    console.log("\n=== Code Analysis Results ===");
    console.log("Summary:", analysis.summary);
    console.log("Impacted Areas:", analysis.impactedAreas.join(", "));
    console.log("Significant Changes:", analysis.significantChanges);
    console.log("Number of Files:", analysis.changes.length);

    return context;
  },
});
