// import { createAction } from "spinai";
// import type { SpinAiContext } from "spinai";

// export const generateDocumentationForFile = createAction({
//     id: "generateDocumentationForFile",
//     description: "Generates MDX documentation for a single file using AI.",
//     parameters: {
//         type: "object",
//         properties: {
//             filePath: { type: "string", description: "Path of the file to document" },
//         },
//         required: ["filePath", "fileContent"],
//     },
//     async run(context: SpinAiContext, parameters?: Record<string, unknown>) {
//         const { filePath,} = parameters;

// //         const prompt = `
// // You are a documentation expert. Generate structured MDX documentation for the following file.
// // File Path: ${filePath}
// // File Content/Summary:
// // ${fileContent}

// // Generate MDX content following best practices. Return only the MDX content without markdown code fences.
// //     `.trim();

// //         const { response } = await context.llm({
// //             messages: [{ role: "user", content: prompt }],
// //             temperature: 0.3,
// //         });

//         return {
//             ...context,
//             state:
//             {
//                 ...context.state,
//                 filePath, documentation: response.trim()
//             }
//         };
//     },
// });
