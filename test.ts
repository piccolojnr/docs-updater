import { createAction, createAgent, createHttpLLM, SpinAiContext } from "spinai";
import dotenv from "dotenv";

dotenv.config();
console.log("Hello, Spin AI!", process.env.GROQ_API_KEY);
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
            // response_format: { type: "json_object" },
        })
    },
    // Transform response to extract the text content
    transformResponse: (response: any) => {
        return response.choices[0]?.message?.content || ""
    }
});



// Define the "answerQuestion" action
const answerQuestion = createAction({
    id: "answerQuestion",
    description: "Answer a user's question using AI.",
    parameters: {
        type: "object",
        properties: {
            query: { type: "string", description: "User's question" }
        },
        required: ["query"],
    },
    async run(context: SpinAiContext, parameters?: Record<string, unknown> | undefined) {
        if (!parameters || typeof parameters.query !== "string") {
            console.log(parameters, context, typeof parameters?.query !== "string");
            throw new Error("Invalid parameters provided for answerQuestion");
        }
        const query = parameters.query;
        console.log(`🧠 Answering question: "${query}"`);

        const response = await groqLLM.complete({
            prompt: query,
            schema: {
                query: "string",
            }
        })
        console.log("🔮 AI Response:", response);

        return {
            ...context,
            state: {
                ...context.state,
                response: response
            }
        }
    },
});

// Define the "fetchUserData" action (simulated API call)
const fetchUserData = createAction({
    id: "fetchUserData",
    description: "Fetch user details from an external API.",
    parameters: {
        type: "object",
        properties: {
            userId: { type: "string", description: "User ID" },
        },
        required: ["userId"],
    },
    async run(context: SpinAiContext, parameters?: Record<string, unknown> | undefined) {
        if (!parameters || typeof parameters.userId !== "string") {
            throw new Error("Invalid parameters provided for fetchUserData");
        }
        const userId = parameters.userId
        console.log(`🔍 Fetching data for user: ${userId}`);
        // Simulated API response
        const userData = {
            userId,
            name: "John Doe",
            email: "johndoe@example.com",
            role: "Admin",
        };
        return {
            ...context,
            state: {
                ...context.state,
                userData,
            },
        };
    },
});

// Create the agent with Groq LLM and actions
const agent = createAgent({
    instructions: `
        You are an AI assistant. 
        - If the user asks a general knowledge question, use the "answerQuestion" action.
        - If the user asks about a specific user ID, use the "fetchUserData" action.
    `,
    llm: groqLLM,
    actions: [answerQuestion, fetchUserData],
    agentId: "groq-agent",
});

// Example: Using the agent to process input
(async () => {
    console.log("\n📝 Example 1: Answering a general question");
    const { response: answerResponse, } = await agent({
        input: "What is the capital of France?",
        state: {},
    });
    console.log("💬 AI Response:", answerResponse);

    // console.log("\n📝 Example 2: Fetching user data");
    // const { response: userDataResponse } = await agent({
    //     input: "Get details for user ID 12345",
    //     state: {},
    // });
    // console.log("📂 User Data Response:", userDataResponse);
})();
