import { createAction } from "spinai";
import type { SpinAiContext } from "spinai";
import type { ReviewState, NavigationItem, GeneratedContent } from "../types";
import { Octokit } from "@octokit/rest";

interface UpdateNavigationParams {
  owner: string;
  repo: string;
}

function isUpdateNavigationParams(
  params: unknown
): params is UpdateNavigationParams {
  return (
    typeof params === "object" &&
    params !== null &&
    typeof (params as any).owner === "string" &&
    typeof (params as any).repo === "string"
  );
}
/**
 * Get the content of the mint.json file in the repository
 * @param octokit - Octokit instance
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param branch - Branch name
 * @param docsPath - Path to the docs directory
 * @returns The content of the mint.json file
 */
async function getMintJsonContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  docsPath: string
): Promise<{ content: string; path: string; sha: string }> {
  // Try first in the docs directory (monorepo case)
  const mintJsonPath = `${docsPath}/mint.json`;
  console.log("Looking for mint.json at:", mintJsonPath);

  try {
    const { data: mintJsonData } = await octokit.repos.getContent({
      owner,
      repo,
      path: mintJsonPath,
      ref: branch,
    });

    if (!("content" in mintJsonData)) {
      throw new Error("mint.json not found or is a directory");
    }

    return {
      content: Buffer.from(mintJsonData.content, "base64").toString("utf-8"),
      path: mintJsonPath,
      sha: mintJsonData.sha,
    };
  } catch (error: any) {
    if (error.status === 404) {
      // If not found in docs directory, try at root (regular Mintlify case)
      console.log("mint.json not found in docs directory, trying root...");
      const { data: rootMintJsonData } = await octokit.repos.getContent({
        owner,
        repo,
        path: "mint.json",
        ref: branch,
      });

      if (!("content" in rootMintJsonData)) {
        throw new Error("mint.json not found or is a directory");
      }

      return {
        content: Buffer.from(rootMintJsonData.content, "base64").toString(
          "utf-8"
        ),
        path: "mint.json",
        sha: rootMintJsonData.sha,
      };
    }
    throw error;
  }
}

/**
 * Apply navigation changes to the current navigation structure
 * @param navigation - Current navigation structure
 * @param changes - List of changes to apply
 * @returns Updated navigation structure
 * @internal
 * @ignore
 * @hidden
 */
function applyNavigationChanges(
  navigation: NavigationItem[],
  changes: Array<{
    type: "add" | "move" | "remove";
    page: string;
    group: string;
  }>
): NavigationItem[] {
  const updatedNavigation = [...navigation];

  for (const change of changes) {
    // Find or create the target group
    let groupIndex = updatedNavigation.findIndex(
      (item) => item.group.toLowerCase() === change.group.toLowerCase()
    );

    if (groupIndex === -1 && change.type === "add") {
      // Create new group if adding a page
      updatedNavigation.push({
        group: change.group,
        pages: [],
      });
      groupIndex = updatedNavigation.length - 1;
    }

    if (groupIndex === -1) {
      console.log(
        `Warning: Group '${change.group}' not found for operation: ${change.type}`
      );
      continue;
    }

    const group = updatedNavigation[groupIndex];

    switch (change.type) {
      case "add":
        if (!group.pages.includes(change.page)) {
          group.pages.push(change.page);
        }
        break;

      case "remove":
        group.pages = group.pages.filter((page) => page !== change.page);
        // Remove empty groups
        if (group.pages.length === 0) {
          updatedNavigation.splice(groupIndex, 1);
        }
        break;

      case "move":
        // Handle moves between groups in a separate pass to avoid conflicts
        const sourceGroupIndex = updatedNavigation.findIndex((item) =>
          item.pages.includes(change.page)
        );
        if (sourceGroupIndex !== -1 && sourceGroupIndex !== groupIndex) {
          // Remove from source group
          updatedNavigation[sourceGroupIndex].pages = updatedNavigation[
            sourceGroupIndex
          ].pages.filter((page) => page !== change.page);
          // Add to target group
          if (!group.pages.includes(change.page)) {
            group.pages.push(change.page);
          }
          // Remove empty source group
          if (updatedNavigation[sourceGroupIndex].pages.length === 0) {
            updatedNavigation.splice(sourceGroupIndex, 1);
          }
        }
        break;
    }
  }

  return updatedNavigation;
}

export const updateNavigation = createAction({
  id: "updateNavigation",
  description:
    "Updates the mint.json navigation structure based on documentation changes",
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
    if (!parameters || !isUpdateNavigationParams(parameters)) {
      throw new Error("Invalid parameters provided");
    }

    const state = context.state as ReviewState;

    if (!state.updatePlan) {
      throw new Error("Update plan must be created before updating navigation");
    }
    if (!state.docStructure) {
      throw new Error(
        "Documentation structure must be analyzed before updating navigation"
      );
    }
    if (!state.generatedContent) {
      throw new Error("Content must be generated before updating navigation");
    }

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    console.log("\n=== Updating Navigation Structure ===");

    // Collect all navigation changes
    const allChanges =
      state.updatePlan.navigationChanges?.flatMap((group) =>
        group.changes.map((change) => ({
          ...change,
          group: group.group,
        }))
      ) || [];

    // Skip if no navigation changes
    if (allChanges.length === 0) {
      console.log("No navigation changes needed, skipping update");
      return context;
    }

    // Get current mint.json content
    const {
      content: mintJsonContent,
      path: mintJsonPath,
      sha,
    } = await getMintJsonContent(
      octokit,
      state.docsRepo?.owner || parameters.owner,
      state.docsRepo?.repo || parameters.repo,
      state.docsRepo?.branch || "main",
      state.config.docsPath
    );

    // Parse current navigation
    const mintJson = JSON.parse(mintJsonContent);
    const currentNavigation: NavigationItem[] = mintJson.navigation || [];

    // Apply changes to navigation structure
    const updatedNavigation = applyNavigationChanges(
      currentNavigation,
      allChanges
    );

    // Update mint.json content
    mintJson.navigation = updatedNavigation;
    const updatedContent = JSON.stringify(mintJson, null, 2);

    // Store navigation update in state
    state.generatedContent.navigationUpdate = {
      path: mintJsonPath,
      content: updatedContent,
      changes: allChanges,
    };

    console.log("\n=== Navigation Update Summary ===");
    console.log("Changes applied:", allChanges.length);
    allChanges.forEach((change) => {
      console.log(
        `- ${change.type}: ${change.page} in group '${change.group}'`
      );
    });

    return context;
  },
});
