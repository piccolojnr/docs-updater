export interface PlannedDocUpdate {
    path: string;
    type: "create" | "update";
    reason: string;
    sourceFiles: string[];
}

