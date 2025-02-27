import { createAction } from "spinai";
import type { SpinAiContext } from "spinai";
import { Octokit } from "@octokit/rest";
import { ReviewState } from "./types";
import micromatch from "micromatch"; // Utility for pattern matching

interface SearchImportantFilesParams {
    owner: string;
    repo: string;
    path?: string;
}

function isSearchImportantFilesParams(params: unknown): params is SearchImportantFilesParams {
    return (
        typeof params === "object" &&
        params !== null &&
        typeof (params as any).owner === "string" &&
        typeof (params as any).repo === "string"
    );
}

export const searchImportantFiles = createAction({
    id: "searchImportantFiles",
    description: "Search for important files in a repository that need initial documentation",
    parameters: {
        type: "object",
        properties: {
            owner: { type: "string", description: "Repository owner" },
            repo: { type: "string", description: "Repository name" },
            path: { type: "string", description: "Directory path to search", default: "" }
        },
        required: ["owner", "repo"],
    },
    async run(context: SpinAiContext, parameters?: Record<string, unknown>) {
        console.log("🔍 Searching for important files...", parameters);
        if (!parameters || !isSearchImportantFilesParams(parameters)) {
            throw new Error("Invalid parameters provided for searchImportantFiles");
        }
        const { owner, repo, path = "" } = parameters;
        if (!process.env.GITHUB_TOKEN) {
            throw new Error("GITHUB_TOKEN environment variable is required");
        }

        const state = context.state as ReviewState;

        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

        const COUNT_LIMIT = 30;

        async function getFilesRecursively(dir: string, importantPatterns: string[], ignorePatterns: string[], count: number = 0): Promise<string[]> {
            try {
                if (count >= COUNT_LIMIT) {
                    return [];
                }
                const response = await octokit.repos.getContent({ owner, repo, path: dir });

                if (!Array.isArray(response.data)) return [];

                let files: string[] = [];



                for (const item of response.data) {
                    const fullPath = dir ? `${dir}/${item.name}` : item.name; // Preserve full path structure

                    if (item.type === "file" && micromatch.isMatch(fullPath, importantPatterns) && !micromatch.isMatch(fullPath, ignorePatterns)) {
                        files.push(fullPath);
                        count++;

                        if (count >= COUNT_LIMIT) {
                            break;
                        }
                    } else if (item.type === "dir" && micromatch.isMatch(fullPath, importantPatterns) && !micromatch.isMatch(fullPath, ignorePatterns)) {
                        const subFiles = await getFilesRecursively(fullPath, importantPatterns, ignorePatterns, count);
                        files = files.concat(subFiles);
                        count += subFiles.length;
                    }
                }
                return files;
            } catch (error) {
                console.error(`Error accessing ${dir}: ${error}`);
                return [];
            }
        }
        try {
            const response = await octokit.repos.getContent({
                owner,
                repo,
                path,
            });

            // Ensure we are dealing with a directory listing
            if (!Array.isArray(response.data)) {
                // If a single file is returned, wrap its name in an array.
                return {
                    ...context,
                    state: {
                        ...context.state,
                        importantFiles: [response.data.name],
                    },
                };
            }

            // ignore directories
            const importantPatterns = state.config.matchRules.importantPatterns;
            const ignorePatterns = state.config.matchRules.ignorePatterns;
            const importantFiles = await getFilesRecursively(path, importantPatterns, ignorePatterns);

            console.log(`Found important files: ${importantFiles.length}`);

            context.state = {
                ...state,
                importantFiles,
            };
            return context;
        } catch (error) {
            throw new Error(`Error searching for important files: ${error}`);
        }
    },
});
