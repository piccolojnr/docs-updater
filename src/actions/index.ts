import { analyzeCodeChanges } from "./analyzeCodeChanges";
import { analyzeDocStructure } from "./analyzeDocStructure";
import { planDocUpdates } from "./planDocUpdates";
import { generateContent } from "./generateContent";
import { updateNavigation } from "./updateNavigation";
import { createDocsPR } from "./createDocsPR";

export const actions = [
  analyzeCodeChanges,
  analyzeDocStructure,
  planDocUpdates,
  generateContent,
  updateNavigation,
  createDocsPR,
];

export * from "./analyzeCodeChanges";
export * from "./analyzeDocStructure";
export * from "./planDocUpdates";
export * from "./generateContent";
export * from "./updateNavigation";
export * from "./createDocsPR";
