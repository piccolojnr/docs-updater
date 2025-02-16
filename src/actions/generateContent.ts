import { createAction } from "spinai";
import type { SpinAiContext } from "spinai";
import type {
  ReviewState,
  PlannedDocUpdate,
  GeneratedContent,
  DocStructure,
  CodeAnalysis,
} from "../types";
import { Octokit } from "@octokit/rest";
import OpenAI from "openai";

interface GenerateContentParams {
  owner: string;
  repo: string;
}

function isGenerateContentParams(
  params: unknown
): params is GenerateContentParams {
  return (
    typeof params === "object" &&
    params !== null &&
    typeof (params as any).owner === "string" &&
    typeof (params as any).repo === "string"
  );
}

async function generateFileContent(
  openai: OpenAI,
  update: PlannedDocUpdate,
  docStructure: DocStructure,
  codeAnalysis: CodeAnalysis,
  existingContent: string | null,
  templateContent: string | null,
  config: ReviewState["config"]
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4-turbo-preview",
    messages: [
      {
        role: "system" as const,
        content: `You are a technical documentation expert specializing in Mintlify MDX documentation.
Your task is to ${update.type === "create" ? "create new" : "update existing"} documentation based on code changes.

MDX Formatting Rules:
1. Use {/* */} for comments, not HTML <!-- --> style
2. Always add a blank line before and after code blocks
3. Ensure code blocks have proper language tags:
   \`\`\`typescript
   // code here
   \`\`\`
4. Use proper heading spacing: "## Heading" not "##Heading"
5. Keep consistent newline spacing - one blank line between sections
6. Use proper MDX components for callouts, tabs, etc.
7. Start with frontmatter (---) containing title and description
8. IMPORTANT: Return the MDX content directly, do not wrap in backticks

Content Guidelines:
- Be precise and technical in descriptions
- Include code examples where relevant
- Follow existing documentation style
- Maintain any existing metadata and tags
- If documenting APIs, include:
  - Function signatures
  - Parameter descriptions
  - Return types
  - Usage examples
${config.llmConfig?.styleGuide ? `\nStyle Guide:\n${config.llmConfig.styleGuide}` : ""}`,
      },
      {
        role: "user" as const,
        content: `Task: ${update.type === "create" ? "Create new" : "Update"} documentation file at ${update.path}

Context:
${update.reason}

Source Files:
${update.sourceFiles
  .map((file) => {
    const change = codeAnalysis.changes.find((c) => c.file === file);
    return `
File: ${file}
Type: ${change?.type || "unknown"}
Patch:
\`\`\`diff
${change?.patch || ""}
\`\`\`
`;
  })
  .join("\n")}

${templateContent ? `Template to follow:\n${templateContent}\n` : ""}
${existingContent ? `Current content to update:\n${existingContent}\n` : ""}

Suggested Structure:
${update.suggestedContent ? JSON.stringify(update.suggestedContent, null, 2) : "Standard documentation structure"}

Related Documentation:
${
  update.relatedDocs
    ?.map((doc) => {
      const existing = docStructure.files.find((f) => f.path === doc);
      return `- ${doc}${existing ? " (exists)" : " (planned)"}`;
    })
    .join("\n") || "No related documentation"
}

Please provide the complete MDX content for this documentation file.
Remember: Return the content directly, starting with frontmatter (---). Do not wrap in backticks.`,
      },
    ],
    temperature: config.llmConfig?.temperature || 0.3,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Failed to generate content");
  }

  // Clean up any accidental backtick wrapping
  return content.replace(/^```mdx?\n|```$/g, "").trim();
}

async function findTemplateFile(
  docStructure: DocStructure,
  update: PlannedDocUpdate
): Promise<string | null> {
  // Look for similar files in the same category
  const category = update.path.split("/").slice(-2, -1)[0];
  const similarFiles = docStructure.files.filter(
    (file) => file.category === category && file.path !== update.path
  );

  if (similarFiles.length > 0) {
    return similarFiles[0].path;
  }

  return null;
}

export const generateContent = createAction({
  id: "generateContent",
  description: "Generates documentation content based on the planned updates",
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
    if (!parameters || !isGenerateContentParams(parameters)) {
      throw new Error("Invalid parameters provided");
    }

    const state = context.state as ReviewState;

    if (!state.updatePlan) {
      throw new Error("Update plan must be created before generating content");
    }
    if (!state.docStructure) {
      throw new Error(
        "Documentation structure must be analyzed before generating content"
      );
    }
    if (!state.codeAnalysis) {
      throw new Error(
        "Code analysis must be performed before generating content"
      );
    }

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    console.log("\n=== Generating Documentation Content ===");

    const generatedContent: GeneratedContent = {
      files: [],
    };

    // Process each planned update
    for (const update of state.updatePlan.updates) {
      console.log(`\nProcessing: ${update.path}`);
      console.log(`Type: ${update.type}`);
      console.log(`Priority: ${update.priority}`);

      let existingContent: string | null = null;
      let templateContent: string | null = null;

      // Get existing content if updating
      if (update.type === "update") {
        try {
          const { data: fileData } = await octokit.repos.getContent({
            owner: state.docsRepo?.owner || parameters.owner,
            repo: state.docsRepo?.repo || parameters.repo,
            path: update.path,
            ref: state.docsRepo?.branch || "main",
          });

          if ("content" in fileData) {
            existingContent = Buffer.from(fileData.content, "base64").toString(
              "utf-8"
            );
            console.log("Found existing content");
          }
        } catch (error) {
          console.log("No existing content found");
        }
      }

      // Find a template file if creating new content
      if (update.type === "create") {
        const templatePath = await findTemplateFile(state.docStructure, update);
        if (templatePath) {
          try {
            const { data: fileData } = await octokit.repos.getContent({
              owner: state.docsRepo?.owner || parameters.owner,
              repo: state.docsRepo?.repo || parameters.repo,
              path: templatePath,
              ref: state.docsRepo?.branch || "main",
            });

            if ("content" in fileData) {
              templateContent = Buffer.from(
                fileData.content,
                "base64"
              ).toString("utf-8");
              console.log("Found template:", templatePath);
            }
          } catch (error) {
            console.log("No template found");
          }
        }
      }

      // Generate content
      const content = await generateFileContent(
        openai,
        update,
        state.docStructure,
        state.codeAnalysis,
        existingContent,
        templateContent,
        state.config
      );

      generatedContent.files.push({
        path: update.path,
        content,
        type: update.type,
        reason: update.reason,
      });

      console.log("Content generated successfully");
    }

    // Store generated content in state
    state.generatedContent = generatedContent;

    console.log("\n=== Content Generation Summary ===");
    console.log("Files generated:", generatedContent.files.length);
    generatedContent.files.forEach((file) => {
      console.log(
        `\n${file.type === "create" ? "Created" : "Updated"}: ${file.path}`
      );
      console.log(`Reason: ${file.reason}`);
      console.log(`Content length: ${file.content.length} characters`);
    });

    return context;
  },
});
