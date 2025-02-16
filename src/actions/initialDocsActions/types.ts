import { DocConfig, DocUpdateConfig } from "../../types";


// ////////////////////////////////////////////////////////////////////////


export interface ReviewState {
    owner: string;
    repo: string;
    config: DocUpdateConfig;

    // searchImportantFiles
    importantFiles?: string[];

    // planInitialDocs
    updatePlan?: UpdatePlan;

    // generateInitialDocs
    generatedContent?: GeneratedContent;
}

export interface UpdatePlan {
    updates: PlannedDocUpdate[];
}



export interface PlannedDocUpdate {
    path: string;
    type: "create" | "update";
    reason: string;
    sourceFiles: string[];
}


export interface GeneratedContent {
    files: Array<{ path: string; content: string; type: "create" | "update"; reason: string }>;
    navigationUpdate?: { path: string; content: string; changes: Array<{ type: "add" | "move" | "remove"; page: string; group: string }> };
}
