import { createAction } from "spinai";
import type { SpinAiContext } from "spinai";
import type { ReviewState } from "../types";
import { Octokit } from "@octokit/rest";

interface CreateDocsPRParams {
  owner: string;
  repo: string;
  pull_number: number;
}

function isCreateDocsPRParams(params: unknown): params is CreateDocsPRParams {
  return (
    typeof params === "object" &&
    params !== null &&
    typeof (params as any).owner === "string" &&
    typeof (params as any).repo === "string" &&
    typeof (params as any).pull_number === "number"
  );
}

export const createDocsPR = createAction({
  id: "createDocsPR",
  description: "Creates a new pull request with documentation updates",
  parameters: {
    type: "object",
    properties: {
      owner: { type: "string", description: "Repository owner" },
      repo: { type: "string", description: "Repository name" },
      pull_number: { type: "number", description: "Original PR number" },
    },
    required: ["owner", "repo", "pull_number"],
  },
  async run(
    context: SpinAiContext,
    parameters?: Record<string, unknown>
  ): Promise<SpinAiContext> {
    console.log("\n=== CreateDocsPR: Starting ===");

    if (!process.env.GITHUB_TOKEN) {
      console.error("GITHUB_TOKEN environment variable is missing");
      throw new Error("GITHUB_TOKEN environment variable is required");
    }
    if (!parameters || !isCreateDocsPRParams(parameters)) {
      throw new Error("Invalid parameters provided");
    }

    const state = context.state as ReviewState;

    if (!state.generatedContent) {
      throw new Error("Content must be generated before creating PR");
    }
    if (!state.updatePlan) {
      throw new Error("Update plan must be created before creating PR");
    }

    const { files, navigationUpdate } = state.generatedContent;
    console.log("Files to process:", files.length);
    console.log("Navigation update:", navigationUpdate ? "Yes" : "No");

    if (files.length === 0 && !navigationUpdate) {
      console.log("No updates to process, skipping PR creation");
      return context;
    }

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    console.log("GitHub client initialized");

    // Get the original PR details
    console.log("Fetching original PR details...");
    const { data: pr } = await octokit.pulls.get({
      owner: parameters.owner,
      repo: parameters.repo,
      pull_number: parameters.pull_number,
    });
    console.log("Original PR found:", pr.title);

    // Create a new branch for documentation updates
    const timestamp = new Date().getTime();
    const newBranch = `${state.config.prConfig.branchPrefix || "docs/update"}-${pr.head.ref}-${timestamp}`;
    console.log("Creating new branch:", newBranch);

    // Get the default branch SHA
    console.log("Fetching repository details...");
    const { data: repo } = await octokit.repos.get({
      owner: parameters.owner,
      repo: parameters.repo,
    });
    console.log("Default branch:", repo.default_branch);

    console.log("Getting default branch SHA...");
    const { data: ref } = await octokit.git.getRef({
      owner: parameters.owner,
      repo: parameters.repo,
      ref: `heads/${repo.default_branch}`,
    });
    console.log("Default branch SHA:", ref.object.sha);

    // Create new branch
    console.log("Creating new branch from SHA...");
    await octokit.git.createRef({
      owner: parameters.owner,
      repo: parameters.repo,
      ref: `refs/heads/${newBranch}`,
      sha: ref.object.sha,
    });
    console.log("New branch created successfully");

    // Process all file updates
    console.log("\n=== Processing Documentation Updates ===");
    const allUpdates = [...files];
    if (navigationUpdate) {
      allUpdates.push({
        ...navigationUpdate,
        type: "update",
        reason: `Update navigation structure (${navigationUpdate.changes.length} changes)`,
      });
    }

    for (const update of allUpdates) {
      console.log("\nProcessing update for file:", update.path);

      let currentFile;
      try {
        // Try to get the current file content
        console.log("Checking if file exists...");
        const { data: fileData } = await octokit.repos.getContent({
          owner: parameters.owner,
          repo: parameters.repo,
          path: update.path,
          ref: newBranch,
        });
        if ("content" in fileData) {
          currentFile = fileData;
        }
      } catch (error: any) {
        if (error.status !== 404) {
          console.error("Error checking file:", error);
          throw error;
        }
        // 404 is expected for new files
        console.log("File doesn't exist - will create new file");
      }

      // Create or update the file
      console.log(
        currentFile ? "Updating existing file..." : "Creating new file..."
      );
      await octokit.repos.createOrUpdateFileContents({
        owner: parameters.owner,
        repo: parameters.repo,
        path: update.path,
        message: update.reason,
        content: Buffer.from(update.content).toString("base64"),
        branch: newBranch,
        ...(currentFile && "sha" in currentFile
          ? { sha: currentFile.sha }
          : {}),
      });
      console.log("File operation completed successfully");
    }

    // Create pull request
    console.log("\n=== Creating Pull Request ===");
    const prTitle = state.config.prConfig.titleTemplate
      ? state.config.prConfig.titleTemplate
          .replace("{prTitle}", pr.title)
          .replace("{prNumber}", parameters.pull_number.toString())
      : `📚 Update documentation for ${pr.title}`;

    const prBody = state.config.prConfig.bodyTemplate
      ? state.config.prConfig.bodyTemplate
          .replace("{prNumber}", parameters.pull_number.toString())
          .replace(
            "{changes}",
            state.updatePlan.updates
              .map(
                (update) => `- ${update.reason} (${update.priority} priority)`
              )
              .join("\n")
          )
      : `This PR updates documentation to reflect changes in #${parameters.pull_number}

## Changes
${state.updatePlan.updates.map((update) => `- ${update.reason} (${update.priority} priority)`).join("\n")}

This PR was automatically generated by the SpinAI documentation maintainer.`;

    const { data: docsPR } = await octokit.pulls.create({
      owner: parameters.owner,
      repo: parameters.repo,
      title: prTitle,
      body: prBody,
      head: newBranch,
      base: repo.default_branch,
    });
    console.log("Pull request created:", docsPR.html_url);

    // Add labels if configured
    if (state.config.prConfig.labels?.length) {
      console.log("Adding labels to PR...");
      await octokit.issues.addLabels({
        owner: parameters.owner,
        repo: parameters.repo,
        issue_number: docsPR.number,
        labels: state.config.prConfig.labels,
      });
      console.log("Labels added successfully");
    }

    // Add a comment to the original PR
    console.log("Adding comment to original PR...");
    await octokit.issues.createComment({
      owner: parameters.owner,
      repo: parameters.repo,
      issue_number: parameters.pull_number,
      body: `I've created a documentation update PR: #${docsPR.number}`,
    });
    console.log("Comment added successfully");

    console.log("\n=== CreateDocsPR: Completed Successfully ===");
    return context;
  },
});
