import { createAction } from "spinai";
import type { SpinAiContext } from "spinai";
import type {
  ReviewState,
  DocStructure,
  DocFile,
  NavigationItem,
} from "../types";
import { Octokit } from "@octokit/rest";
import OpenAI from "openai";

interface AnalyzeDocStructureParams {
  owner: string;
  repo: string;
}

function isAnalyzeDocStructureParams(
  params: unknown
): params is AnalyzeDocStructureParams {
  return (
    typeof params === "object" &&
    params !== null &&
    typeof (params as any).owner === "string" &&
    typeof (params as any).repo === "string"
  );
}

async function buildDocStructure(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  docsDir: string
): Promise<DocStructure> {
  const files: DocFile[] = [];
  const categories = new Set<string>();
  let fileTree = "";
  let navigation: NavigationItem[] = [];

  async function traverse(currentPath: string, depth: number = 0) {
    try {
      const { data: contents } = await octokit.repos.getContent({
        owner,
        repo,
        path: currentPath,
        ref: branch,
      });

      for (const item of Array.isArray(contents) ? contents : [contents]) {
        // Add to file tree with proper indentation
        fileTree += `${" ".repeat(depth * 2)}${item.type === "dir" ? "📁" : "📄"} ${item.path}\n`;

        if (item.type === "dir") {
          // Add category if it's a direct subdirectory of docsDir
          if (currentPath === docsDir) {
            categories.add(item.name);
          }
          await traverse(item.path, depth + 1);
        } else if (item.path.endsWith(".mdx") || item.path.endsWith(".md")) {
          // Extract category from path
          const pathParts = item.path.split("/");
          const category = pathParts[pathParts.length - 2];

          // Add file to the collection
          files.push({
            path: item.path,
            type: item.type,
            category,
          });
        } else if (item.path.endsWith("mint.json")) {
          try {
            // Get navigation structure from mint.json
            const { data: fileData } = await octokit.repos.getContent({
              owner,
              repo,
              path: item.path,
              ref: branch,
            });

            if ("content" in fileData) {
              const content = Buffer.from(fileData.content, "base64").toString(
                "utf-8"
              );
              const mintJson = JSON.parse(content);
              navigation = mintJson.navigation || [];
            }
          } catch (error) {
            console.error("Error reading mint.json:", error);
          }
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${currentPath}:`, error);
    }
  }

  // Start traversal from docs directory
  await traverse(docsDir);

  return {
    files,
    categories: Array.from(categories),
    navigation,
    fileTree,
  };
}

async function analyzeDocReferences(
  openai: OpenAI,
  docStructure: DocStructure,
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string
): Promise<DocStructure> {
  // For each documentation file, analyze its content for references
  for (const file of docStructure.files) {
    try {
      const { data: fileData } = await octokit.repos.getContent({
        owner,
        repo,
        path: file.path,
        ref: branch,
      });

      if ("content" in fileData) {
        const content = Buffer.from(fileData.content, "base64").toString(
          "utf-8"
        );

        // Use LLM to analyze file content for references
        const response = await openai.chat.completions.create({
          model: "gpt-4-turbo-preview",
          messages: [
            {
              role: "system" as const,
              content: `You are a documentation analyzer. Analyze this documentation file and identify:
1. References to other documentation files or sections
2. Code files or packages it documents
3. Related documentation that should be updated together

Return your analysis as a JSON object with this structure:
{
  "references": ["file1", "file2"],
  "codeFiles": ["code1", "code2"],
  "relatedDocs": ["doc1", "doc2"]
}`,
            },
            {
              role: "user" as const,
              content: `Documentation file: ${file.path}\n\nContent:\n${content}`,
            },
          ],
          temperature: 0.1,
          response_format: { type: "json_object" },
        });

        const analysis = JSON.parse(
          response.choices[0]?.message?.content || "{}"
        );

        // Update file with references
        file.references = Array.from(
          new Set([
            ...(analysis.references || []),
            ...(analysis.codeFiles || []),
            ...(analysis.relatedDocs || []),
          ])
        );
      }
    } catch (error) {
      console.error(`Error analyzing references for ${file.path}:`, error);
    }
  }

  return docStructure;
}

export const analyzeDocStructure = createAction({
  id: "analyzeDocStructure",
  description:
    "Analyzes the documentation repository structure and relationships between files",
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
    if (!process.env.GITHUB_TOKEN) {
      throw new Error("GITHUB_TOKEN environment variable is required");
    }
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }
    if (!parameters || !isAnalyzeDocStructureParams(parameters)) {
      throw new Error("Invalid parameters provided");
    }

    const state = context.state as ReviewState;
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Get docs repository information
    const docsRepo = state.docsRepo || {
      owner: parameters.owner,
      repo: parameters.repo,
      branch: "main",
    };

    console.log("\n=== Analyzing Documentation Structure ===");
    console.log("Repository:", `${docsRepo.owner}/${docsRepo.repo}`);
    console.log("Branch:", docsRepo.branch);
    console.log("Docs Directory:", state.config.docsPath);

    // Build initial structure
    let docStructure = await buildDocStructure(
      octokit,
      docsRepo.owner,
      docsRepo.repo,
      docsRepo.branch,
      state.config.docsPath
    );

    // Analyze references between files
    docStructure = await analyzeDocReferences(
      openai,
      docStructure,
      octokit,
      docsRepo.owner,
      docsRepo.repo,
      docsRepo.branch
    );

    // Store results in state
    state.docStructure = docStructure;

    console.log("\n=== Documentation Analysis Results ===");
    console.log("Total Files:", docStructure.files.length);
    console.log("Categories:", docStructure.categories.join(", "));
    console.log("\nFile Structure:");
    console.log(docStructure.fileTree);

    return context;
  },
});
