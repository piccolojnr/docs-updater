import { createAction } from "spinai";
import type { SpinAiContext } from "spinai";
import { Octokit } from "@octokit/rest";

export const listRepositoryFiles = createAction({
    id: "listRepositoryFiles",
    description:
        "Lists all files in a GitHub repository, optionally ignoring files or folders based on provided patterns.",
    parameters: {
        type: "object",
        properties: {

        },
        required: [],
    },
    async run(
        context: SpinAiContext,
        parameters?: Record<string, unknown>
    ) {
        console.log("📂 Listing repository files...", parameters);
        const { username, repository, branch = "main" } = context.state;

        if (!process.env.GITHUB_TOKEN) {
            throw new Error("GITHUB_TOKEN environment variable is required");
        }

        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

        // Get the latest commit SHA from the branch.
        const branchInfo = await octokit.repos.getBranch({
            owner: username,
            repo: repository,
            branch,
        });
        const commitSha = branchInfo.data.commit.sha;

        // Fetch the entire repository tree recursively.
        const treeResponse = await octokit.git.getTree({
            owner: username,
            repo: repository,
            tree_sha: commitSha,
            recursive: "1",
        });

        // Filter the tree to include only file blobs.
        const files = treeResponse.data.tree
            .filter((item) => item.type === "blob")
            .map((item) => item.path);

        console.log(`📂 Found ${files.length} files in the repository`);
        // Apply ignore patterns: skip files that contain any of the provided substrings.
        // const filteredFiles = files.filter((file) => {
        //     return !ignore.some((pattern) => file.includes(pattern));
        // });

        // Return the filtered list of file paths.
        return {
            ...context,
            state: {
                ...context.state,
                files
            }
        };
    },
});
