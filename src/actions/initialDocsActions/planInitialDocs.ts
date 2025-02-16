import { createAction } from "spinai";
import type { SpinAiContext } from "spinai";
import type { ReviewState, PlannedDocUpdate } from "./types";
import { Octokit } from "@octokit/rest";

interface PlanInitialDocsParams {
    owner: string;
    repo: string;
}

function isPlanInitialDocsParams(params: unknown): params is PlanInitialDocsParams {
    return (
        typeof params === "object" &&
        params !== null &&
        typeof (params as any).owner === "string" &&
        typeof (params as any).repo === "string"
    );
}

export const planInitialDocs = createAction({
    id: "planInitialDocs",
    description: "Plans initial documentation updates based on important files found in the repository",
    parameters: {
        type: "object",
        properties: {
            owner: { type: "string", description: "Repository owner" },
            repo: { type: "string", description: "Repository name" },
        },
        required: ["owner", "repo"],
    },
    async run(context: SpinAiContext, parameters?: Record<string, unknown>) {
        if (!parameters || !isPlanInitialDocsParams(parameters)) {
            throw new Error("Invalid parameters provided for planInitialDocs");
        }

        const { owner, repo } = parameters;
        if (!process.env.GITHUB_TOKEN) {
            throw new Error("GITHUB_TOKEN environment variable is required");
        }

        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        const state = context.state as ReviewState;

        if (!state.importantFiles || state.importantFiles.length === 0) {
            throw new Error("No important files found to document. Run searchImportantFiles first.");
        }

        console.log(`🔍 Checking which files already have documentation...`);

        const plannedUpdates: PlannedDocUpdate[] = [];
        for (const file of state.importantFiles) {
            const docFilePath = `docs/${file.replace(/\.[^/.]+$/, "")}.md`; // Convert to MDX filename

            let fileExists = false;
            try {
                await octokit.repos.getContent({ owner, repo, path: docFilePath });
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
                ...state,
                updatePlan: {
                    updates: plannedUpdates

                },
            },
        };
    },
});
