import { searchImportantFiles } from "./searchImportantFiles";
import { planInitialDocs } from "./planInitialDocs";
import { generateInitialDocs } from "./generateInitialDocs";
import { createInitialDocsPR } from "./createInitialDocsPR";

export const initialDocumentationActions = [
    searchImportantFiles,
    planInitialDocs,
    generateInitialDocs,
    createInitialDocsPR,
];

export * from "./searchImportantFiles";
export * from "./planInitialDocs";
export * from "./generateInitialDocs";
export * from "./createInitialDocsPR";
