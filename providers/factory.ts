import { Api, Message} from "./types.ts";
import { createAnthropicApi } from "./anthropic.ts";
import { createOpenAiApi } from "./openai.ts";
import { tools } from "../tools/tools.ts"

export function createApi(): Api {
    let api: Api;
    const provider = process.env.PROVIDER || "anthropic"
    if (provider === "anthropic" ){
    api = createAnthropicApi({
            name: "anthropic",
            apiKey: process.env.ANTHROPIC_API_KEY ?? "",
            baseURL: "https://api.anthropic.com",
            version: "2023-06-01",
            max_tokens: 4096,
        })
    } else if (provider === "openai"){
        api = createOpenAiApi({
            name: "openai",
            baseURL: "https://api.openai.com",
            apiKey: process.env.OPENAI_API_KEY ?? "",
        })
    } else {
        // openai 兼容的格式
        api = createOpenAiApi({
            name: process.env.PROVIDER || "openai",
            baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.openai.com",
            apiKey: process.env.DEEPSEEK_API_KEY ?? "", 
        })
    }
    return api
}

export async function callLLM(messages: Message[], signal?: AbortSignal){
    const api = createApi()
    const response = await api.complete({
        model: process.env.MODEL || "deepseek-v4-flash",
        messages,
        tools: tools,
        signal: signal,
    })
    return response.message
}

export async function callLLMStream(messages: Message[], signal?: AbortSignal) {
    const api = createApi()
    let finalMessage: Message = { role: "assistant", content: "" };
    for await (const ev of api.stream({
        model: process.env.MODEL || "deepseek-v4-flash",
        messages,
        tools,
    })) {
        if (ev.type === "text_delta") {
            process.stdout.write(ev.delta)
        } else if (ev.type === "tool_use_start") {
            // 可选:提示"要调 xxx 工具了"
            process.stdout.write(`\n[调用 ${ev.name}...`);
        } else if (ev.type === "tool_use_end") {
            process.stdout.write(`]\n`);
        } else if (ev.type === "done") {
            finalMessage = ev.message;
        }
    }
    process.stdout.write("\n")
    return finalMessage

}


