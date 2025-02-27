import { createAction } from "spinai";
import type { SpinAiContext } from "spinai";
import type { ReviewState, GeneratedContent, PlannedDocUpdate } from "./types";
import { Octokit } from "@octokit/rest";
import Groq from "groq-sdk";

interface GenerateInitialDocsParams {
    owner: string;
    repo: string;
}

function isGenerateInitialDocsParams(params: unknown): params is GenerateInitialDocsParams {
    return (
        typeof params === "object" &&
        params !== null &&
        typeof (params as any).owner === "string" &&
        typeof (params as any).repo === "string"
    );
}

export const generateInitialDocs = createAction({
    id: "generateInitialDocs",
    description: "Generates structured MDX documentation for each planned file",
    parameters: {
        type: "object",
        properties: {
            owner: { type: "string", description: "Repository owner" },
            repo: { type: "string", description: "Repository name" }
        },
        required: ["owner", "repo"],
    },
    async run(context: SpinAiContext, parameters?: Record<string, unknown>) {
        if (!parameters || !isGenerateInitialDocsParams(parameters)) {
            throw new Error("Invalid parameters provided for generateInitialDocs");
        }
        const { owner, repo } = parameters;

        if (!process.env.OPENAI_API_KEY) {
            throw new Error("OPENAI_API_KEY environment variable is required");
        }
        if (!process.env.GITHUB_TOKEN) {
            throw new Error("GITHUB_TOKEN environment variable is required");
        }

        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        const cachePath = ".docgen-cache.json";
        let cache: Record<string, string> = {}; // Mapping update.path -> generated MDX content
        let cacheSha: string | undefined = undefined;

        // Try to load the persistent cache from the repository
        try {
            const { data } = await octokit.repos.getContent({
                owner,
                repo,
                path: cachePath,
            });
            // Data should be a file with base64-encoded content
            if (!Array.isArray(data) && "content" in data) {
                const decoded = Buffer.from(data.content, "base64").toString("utf8");
                cache = JSON.parse(decoded);
                cacheSha = data.sha;
                console.log("✅ Loaded persistent cache from repository.");
            }
        } catch (error: any) {
            if (error.status === 404) {
                console.log("ℹ️ No persistent cache found; starting with an empty cache.");
                cache = {};
            } else {
                throw error;
            }
        }

        const groqClient = new Groq({ apiKey: process.env.OPENAI_API_KEY });
        const state = context.state as ReviewState;

        if (!state.updatePlan || state.updatePlan.updates.length === 0) {
            throw new Error("No planned documentation updates found. Run planInitialDocs first.");
        }

        console.log(`📄 Generating structured documentation for ${state.updatePlan.updates.length} files...`);

        const generatedContent: GeneratedContent = { files: [] };

        // Process each planned documentation update
        for (const update of state.updatePlan.updates) {
            console.log(`Processing update for: ${update.path}`);

            // If cached, reuse the generated documentation
            if (cache[update.path]) {
                console.log(`🔄 Using cached documentation for: ${update.path}`);
                generatedContent.files.push({
                    path: update.path,
                    content: cache[update.path],
                    type: "create",
                    reason: `Retrieved from persistent cache for ${update.sourceFiles[0]}`,
                });
                continue;
            }

            console.log(`✏️ Generating documentation for: ${update.path}`);

            // Derive a human-friendly title from the first source file
            const cleanTitle = update.sourceFiles[0]
                .replace(/^app\//, "")
                .replace(/\//g, " > ")
                .replace(/\.[^/.]+$/, "");
            const docTemplate = `---
title: "${cleanTitle}"
description: "Documentation for ${update.sourceFiles[0]} in the ${repo} repository."
tags: [documentation, ${repo}]
---

# ${cleanTitle}

## Overview
Provide a brief overview of what **${update.sourceFiles[0]}** does.

## Usage
Explain how this file is used within the project. If applicable, provide relevant code snippets.

## Examples
Provide sample code usage or examples that show how this file integrates into the project.

## References
- Related files: ${update.sourceFiles.join(", ")}
- Repository: [${repo}](https://github.com/${owner}/${repo})`;

            const prompt = `Write structured MDX documentation for the following file:
      
- **File Name:** ${update.sourceFiles[0]}
- **Project:** ${repo}
- **Overview:** Briefly describe what this file does.
- **Usage:** Explain how this file is used and its purpose in the repository.
- **Examples:** Provide example usage, such as function calls or configurations.
- **References:** List related files and documentation links.

Follow this structure and return **only the MDX content**:
\`\`\`mdx
${docTemplate}
\`\`\``;

            try {
                const response = await groqClient.chat.completions.create({
                    model: process.env.OPENAI_MODEL || "llama-3.3-70b-versatile",
                    messages: [
                        {
                            role: "system",
                            content: "You are a documentation expert. Generate structured MDX documentation based on best practices.",
                        },
                        {
                            role: "user",
                            content: prompt,
                        },
                    ],
                    temperature: 0.3,
                });

                const content = response.choices[0]?.message?.content;
                if (!content) {
                    throw new Error(`Failed to generate documentation for ${update.sourceFiles[0]}`);
                }
                const trimmedContent = content.replace(/^```mdx?\n|```$/g, "").trim();

                // Persist the generated content in the cache
                cache[update.path] = trimmedContent;

                generatedContent.files.push({
                    path: update.path,
                    content: trimmedContent,
                    type: "create",
                    reason: `Generated structured documentation for ${update.sourceFiles[0]}`,
                });

                console.log(`✅ Documentation generated for ${update.sourceFiles[0]}`);
            } catch (err) {
                console.error(`❌ Error generating documentation for ${update.sourceFiles[0]}:`, err);
                throw err;
            }
        }

        // Persist the updated cache file to the repository
        try {
            const cacheString = JSON.stringify(cache, null, 2);
            const encodedCache = Buffer.from(cacheString).toString("base64");

            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: cachePath,
                message: "Update documentation generation cache",
                content: encodedCache,
                branch: "main", // Adjust if necessary
                sha: cacheSha,
            });
            console.log("📂 Persistent cache updated successfully.");
        } catch (error) {
            console.error("❌ Error updating persistent cache:", error);
            // Optionally, continue without failing the entire process.
        }

        // Update the context state with the generated content
        state.generatedContent = generatedContent;

        return {
            ...context,
            state,
        };
    },
});
