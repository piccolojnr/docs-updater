import { createAction } from "spinai";
import type { SpinAiContext } from "spinai";
import type { ReviewState, GeneratedContent } from "./types";
import { Octokit } from "@octokit/rest";
import path from "path";
import { randomUUID } from "crypto";

interface CreateInitialDocsPRParams {
    owner: string;
    repo: string;
}

function isCreateInitialDocsPRParams(params: unknown): params is CreateInitialDocsPRParams {
    return (
        typeof params === "object" &&
        params !== null &&
        typeof (params as any).owner === "string" &&
        typeof (params as any).repo === "string"
    );
}

export const createInitialDocsPR = createAction({
    id: "createInitialDocsPR",
    description: "Creates a new GitHub branch, commits the initial documentation, and opens a pull request",
    parameters: {
        type: "object",
        properties: {
            owner: { type: "string", description: "Repository owner" },
            repo: { type: "string", description: "Repository name" }
        },
        required: ["owner", "repo"],
    },
    async run(context: SpinAiContext, parameters?: Record<string, unknown>) {
        if (!parameters || !isCreateInitialDocsPRParams(parameters)) {
            throw new Error("Invalid parameters provided for createInitialDocsPR");
        }

        const { owner, repo } = parameters;
        if (!process.env.GITHUB_TOKEN) {
            throw new Error("GITHUB_TOKEN environment variable is required");
        }

        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        const state = context.state as ReviewState;

        if (!state.generatedContent || state.generatedContent.files.length === 0) {
            throw new Error("No generated documentation found. Run generateInitialDocs first.");
        }

        console.log(`📂 Preparing to commit ${state.generatedContent.files.length} files...`);

        const baseBranch = state.config.docsRepo?.branch || "main";
        const newBranch = "docs/init_" + randomUUID().replace(/-/g, "").substring(0, 8);

        let branchExists = false;
        try {
            // Check if the branch already exists
            await octokit.repos.getBranch({ owner, repo, branch: newBranch });
            branchExists = true;
            console.log(`✅ Branch ${newBranch} already exists, using existing branch.`);
        } catch (error) {
            console.log(`⚡ Branch ${newBranch} does not exist, creating it.`);
        }


        // Fetch the latest commit SHA from the base branch
        const { data: baseBranchData } = await octokit.repos.getBranch({
            owner,
            repo,
            branch: baseBranch,
        });
        const baseSha = baseBranchData.commit.sha;

        if (!branchExists) {
            // Create the new branch if it does not exist
            await octokit.git.createRef({
                owner,
                repo,
                ref: `refs/heads/${newBranch}`,
                sha: baseSha,
            });
            console.log(`🔀 Created new branch: ${newBranch}`);
        }

        // Commit each file separately
        const createdFiles = [];
        for (const file of state.generatedContent.files) {
            const filePath = path.normalize(file.path).replace(/\\/g, "/"); // Normalize for GitHub path format
            const fileContent = Buffer.from(file.content, "utf-8").toString("base64");

            console.log(`📄 Processing: ${filePath}`);

            // Create directories by ensuring each part of the path exists
            const dirPath = path.dirname(filePath);
            if (dirPath !== "docs") {
                try {
                    await octokit.repos.createOrUpdateFileContents({
                        owner,
                        repo,
                        path: `${dirPath}/.keep`, // Create a .keep file to ensure directory existence
                        message: `📁 Ensure directory exists: ${dirPath}`,
                        content: Buffer.from("").toString("base64"),
                        branch: newBranch,
                    });
                    console.log(`📁 Created directory: ${dirPath}`);
                } catch (error) {
                    console.log(`⚠️ Directory ${dirPath} already exists or could not be created.`);
                }
            }

            // Get SHA if the file exists (to update instead of create)
            let existingSha: string | undefined;
            try {
                const { data } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: filePath,
                    ref: newBranch,
                });
                existingSha = (data as any).sha;
            } catch {
                existingSha = undefined; // File doesn't exist yet
            }

            // Create or update the file
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: filePath,
                message: `📝 Add initial documentation for ${path.basename(filePath)}`,
                content: fileContent,
                branch: newBranch,
                sha: existingSha, // Required if updating an existing file
            });

            createdFiles.push(filePath);
        }

        console.log(`✅ Committed ${createdFiles.length} files.`);

        // Create Pull Request
        const prTitle = "📚 Initial Project Documentation";
        const prBody = `This PR adds the initial documentation for the project.\n\n### 📂 New Files:\n- ${createdFiles.join("\n- ")}\n\nThese documents provide an overview of key project files.`;

        console.log(`🔀 Opening PR from ${newBranch} → ${baseBranch}`);
        const prResponse = await octokit.pulls.create({
            owner,
            repo,
            title: prTitle,
            body: prBody,
            head: newBranch,
            base: baseBranch,
        });

        console.log(`✅ Pull request created: ${prResponse.data.html_url}`);

        return {
            ...context,
            state: {
                ...state,
                pullRequestUrl: prResponse.data.html_url,
            },
        };
    },
});
