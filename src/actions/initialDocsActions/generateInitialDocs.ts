import { createAction } from "spinai";
import type { SpinAiContext } from "spinai";
import type { ReviewState, GeneratedContent, PlannedDocUpdate } from "./types";
import { Octokit } from "@octokit/rest";
import OpenAI from "openai";

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

        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const state = context.state as ReviewState;

        if (!state.updatePlan || state.updatePlan.updates.length === 0) {
            throw new Error("No planned documentation updates found. Run planInitialDocs first.");
        }

        console.log(`📄 Generating structured documentation for ${state.updatePlan.updates.length} files...`);

        const generatedContent: GeneratedContent = { files: [] };

        for (const update of state.updatePlan.updates) {
            console.log(`✏️ Generating documentation for: ${update.path}`);

            // Extract meaningful file name without full path
            const cleanTitle = update.sourceFiles[0]
                .replace(/^app\//, "") // Remove "app/" prefix
                .replace(/\//g, " > ") // Convert slashes to " > " for readability
                .replace(/\.[^/.]+$/, ""); // Remove file extensions
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

            const response = await openai.chat.completions.create({
                model: "gpt-4-turbo-preview",
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

            generatedContent.files.push({
                path: update.path,
                content: content.replace(/^```mdx?\n|```$/g, "").trim(),
                type: "create",
                reason: `Generated structured documentation for ${update.sourceFiles[0]}`,
            });

            console.log(`✅ Documentation generated for ${update.sourceFiles[0]}`);
        }

        return {
            ...context,
            state: {
                ...state,
                generatedContent,
            },
        };
    },
});
