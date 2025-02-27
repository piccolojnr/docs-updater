import { Octokit } from "@octokit/rest";
import Groq from "groq-sdk";
import { createAction } from "spinai";
import type { SpinAiContext } from "spinai";
import { PlannedDocUpdate } from "../types";



export const planDocumentationUpdates = createAction({
    id: "planDocumentationUpdates",
    description:
        "Analyzes repository file paths and determines which files need documentation and which should be ignored. Optionally takes into account the framework used in the project.",
    parameters: {
        type: "object",
        properties: {
        },
        required: [],
    },
    async run(context: SpinAiContext, parameters?: Record<string, unknown>
    ) {

        console.log("📝 Planning documentation updates...", parameters);
        if (!process.env.GROQ_API_KEY) {
            throw new Error("GROQ_API_KEY environment variable is required");
        }
        if (!process.env.GITHUB_TOKEN) {
            throw new Error("GITHUB_TOKEN environment variable is required");
        }

        const { files, framework, username, repository } = context.state;

        const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });

        // Construct the prompt for the LLM
        const prompt = `
You are an expert in software documentation and project organization.
The project uses ${framework ? framework : "no specific framework"}.
Given the following list of repository file paths, please analyze and decide which files should be documented and which files can be safely ignored for documentation purposes.
Return your answer strictly as a JSON object with two keys: "filesToDocument" and "filesToIgnore". Each key should have an array of file paths.

You are an expert in software documentation and project organization with years of experience creating clear, concise, and useful documentation for complex codebases.

The project uses ${framework ? framework + " and" : "no specific framework but"}  follows standard programming practices.

Given the following list of repository file paths, please analyze and categorize them into files that should be documented for developers and files that can be safely ignored for documentation purposes.

Documentation guidelines:
- Focus on documenting code files that contain business logic, application functionality, or custom implementations
- Prioritize files that other developers would need to understand to work with the codebase
- Document architecture-defining files and key configuration files that affect system behavior

Ignore the following types of files:
- All markdown (.md) files (these are likely documentation themselves)
- Package management files (package.json, package-lock.json, yarn.lock, etc.)
- Generated files and build artifacts
- Standard configuration files with minimal customization
- Dependency directories (node_modules, vendor, etc.)
- Testing data files
- Backup files, logs, and temporary files
- Any file that is not part of the working area for developers

Return your answer strictly as a JSON object with exactly two keys:
1. "filesToDocument": Array of file paths that should be prioritized for documentation
2. "filesToIgnore": Array of file paths that can be safely excluded from documentation efforts

For each file you choose to document, prioritize based on its importance to the system architecture and developer onboarding.

Example response format:
{
  "filesToDocument": [
    "src/core/main.js",
    "src/utils/helpers.js"
  ],
  "filesToIgnore": [
    "README.md",
    "package.json",
    "node_modules/",
    "tests/fixtures/"
  ]
}
`.trim();

        // Use the LLM from the action context to process the prompt.
        const response = await groqClient.chat.completions.create({
            model: process.env.OPENAI_MODEL || "llama-3.3-70b-versatile",
            messages: [
                {
                    role: "system",
                    content: prompt,
                },
                {
                    role: "user",
                    content: `Here is the list of file paths:
${files.join("\n")}
Only output the JSON object.
    `.trim(),
                },
            ],
            temperature: 0.3,
            response_format: { type: "json_object" },
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            throw new Error("Failed to generate documentation plan");
        }

        let result: { filesToDocument: string[]; filesToIgnore: string[] };
        try {
            result = JSON.parse(content);
        } catch (err) {
            throw new Error("Failed to parse LLM response as JSON: " + err);
        }

        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

        const plannedUpdates: PlannedDocUpdate[] = [];
        for (const file of result.filesToDocument) {
            const docFilePath = `docs/${file.replace(/\.[^/.]+$/, "")}.md`; // Convert to MDX filename
            console.log(`📄 Planning documentation for: ${file} -> ${docFilePath}`);

            let fileExists = false;
            try {
                await octokit.repos.getContent({ owner: username, repo: repository, path: docFilePath });
                fileExists = true;
            } catch (error) {
                fileExists = false;
            }

            if (!fileExists) {
                console.log(`📄 Planning documentation for: ${file} -> ${docFilePath}`);

                plannedUpdates.push({
                    path: docFilePath,
                    type: "create",
                    reason: `Initial documentation for ${file}`,
                    sourceFiles: [file],
                });
            } else {
                console.log(`✅ Documentation already exists for ${file}, skipping.`);
            }

        }

        if (plannedUpdates.length === 0) {
            console.log("🎉 All important files already have documentation. Nothing to generate.");
        }

        return {
            ...context,
            state: {
                ...context.state,
                plan: plannedUpdates,
            },
        };
    },
});
