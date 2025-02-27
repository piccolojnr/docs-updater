import { createAction, createAgent, createHttpLLM, SpinAiContext } from "spinai";
import dotenv from "dotenv";
import { listRepositoryFiles } from "./actions/listRepositoryFiles";
import { planDocumentationUpdates } from "./actions/planDocumentationUpdates";

dotenv.config();

// Define the Groq-based LLM
const groqLLM = createHttpLLM({
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    apiKey: process.env.GROQ_API_KEY, // Ensure the API key is set in your environment
    headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
    },
    // Transform request body to match Groq API expectations
    transformRequest: (body: any) => {
        return ({
            model: "llama-3.1-8b-instant", // Change if using another Groq model
            messages: body.messages,
            temperature: body.temperature ?? 0.7,
            max_tokens: body.max_tokens ?? 1024,
        })
    },
    // Transform response to extract the text content
    transformResponse: (response: any) => {
        return response.choices[0]?.message?.content || ""
    }
});

const agent = createAgent({
    instructions: `
      You are an expert in software documentation  generation agent that creates baseline documentation for repositories.
When triggered, you:
1. Get a list of all files in a GitHub repository.
2. Analyze the files and determine which ones need documentation.
3. End 
    `,
    llm: groqLLM,
    actions: [listRepositoryFiles, planDocumentationUpdates],
    agentId: "groq-agent",
});


(async () => {
    try {
        const { response: answerResponse, } = await agent({
            input: "What is the capital of France?",
            state: {
                username: "piccolojnr",
                repository: "docs-updater",
            },
        });
    } catch (error) {
        console.error("Error running agent:", error);
    }
})();
