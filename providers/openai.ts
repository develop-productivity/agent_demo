//文件目标 providers/openai.ts 输出一个 factory：给它 baseURL + apiKey + name，返回一个 Api 对象
import type {Api, CompletionRequest, CompletionResponse, Message, ToolCall, Tool,StreamEvent} from "./types.ts"
import {iterateSse} from "./sse.ts"

export interface OpenAiConfig {
    name: string;
    baseURL: string;
    apiKey: string;
    headers?: Record<string, string>
};

export interface OpenAiResponse {
    choices: Array<{
        message: {
            role: string; content: string; tool_calls?: OpenAiToolCall[];
        };
        finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
    
}

interface OpenAiToolCall {
    id: string;
    type: "function" | string;
    function: {name: string; arguments: string}
}

interface OpenAiTextMessage {
    role: "user" | "assistant" | "system";
    content: string;
    tool_calls?: OpenAiToolCall[];
}
interface OpenAiToolMessage {
    role: "tool";
    tool_call_id: string;
    content: string;
}
type OpenAIMessage = OpenAiTextMessage | OpenAiToolMessage;

function toOpenAiToolCall (tc: ToolCall) : OpenAiToolCall {
    // 保持原样
    return  {
        ...tc,
        type: "function",
        function: {name: tc.name, arguments: JSON.stringify(tc.arguments)}
    }
}

function toOpenAiMessage(messages: Message[]) : OpenAIMessage[] {
    return messages.map(m =>{
        switch (m.role) {
            case "user": return m;
            case "system": return m;
            case "assistant": {
                // TODO
                //   - content 原样（或 "" 兜底）
                //   - toolCalls 存在且非空 → 加 tool_calls: [...map(toOpenAiToolCall)]
                //   - 不存在或空 → 不带 tool_calls 字段;
                const out : OpenAiTextMessage = {
                    role: "assistant",
                    content: m.content ?? "",
                }
                if (m.toolCalls?.length) {
                    out.tool_calls = m.toolCalls.map(toOpenAiToolCall);
                }
                return out
            }
            case "tool" : {
                return {
                    ...m,
                    role: "tool",
                    tool_call_id: m.toolCallId,
                    content: m.isError ? `[ERROR] ${m.content}` : m.content
                }
            }
            default : {
                const _exhaustive: never = m;
                throw new Error(`Unknown role: ${JSON.stringify(m)}`);
            }
        }
    })

}

function toOpenAiTool(tools: Tool[]) {
    return tools.map(t => ({
        type: "function" as const,
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
        }
    }))
}


function mapStopReason(fr: OpenAiResponse["choices"][number]["finish_reason"]):CompletionResponse["stopReason"]{
    switch(fr) {
        case "stop": return "end_turn";
        case "length": return "max_tokens";
        case "tool_calls": return "tool_use";
        case "content_filter": return "stop_sequence";
        default:return "end_turn";
    }
}

function mapToolCall(tc: OpenAiToolCall): ToolCall {
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(tc.function.arguments); } catch { /* 保留 {} */ }
    return {
        id: tc.id,
        name: tc.function.name,
        arguments: parsed
    }
}

function fromOpenAiResponse(response: OpenAiResponse) :CompletionResponse {
    const choice = response.choices[0];
    if (!choice) throw new Error("OpenAI response has no choices");   // 极端情况
    const msg = choice.message;
    return {
        message: {
              role: "assistant" as const,
              content: msg.content ?? "",
              ...(msg.tool_calls?.length ? { toolCalls: msg.tool_calls.map(mapToolCall) } : {})
          },
        stopReason: mapStopReason(choice.finish_reason), 
        usage: response.usage? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens
        }: undefined
    }
}

export function createOpenAiApi(config: OpenAiConfig) : Api {
    return {
        name: config.name,
        async complete(req: CompletionRequest) : Promise<CompletionResponse> {
            const body = {
                model: req.model,
                messages: toOpenAiMessage(req.messages),
                tools: req.tools?.length? toOpenAiTool(req.tools) : undefined,
                stream: false
                // stream_options: { include_usage: true },   // ← 有没有加这个?
                
            }
            const res = await fetch(`${config.baseURL}/chat/completions`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${config.apiKey}`,
                    "Content-Type": "application/json",
                    ...(config.headers || {}),
                },
                body: JSON.stringify(body)
            })
            if (!res.ok) {
                throw new Error(`${config.name} ${res.status}: ${await res.text()}`);
            }
            return fromOpenAiResponse(await res.json() as OpenAiResponse)
        },

        async *stream(req: CompletionRequest) : AsyncIterable<StreamEvent> {
            const body = {
                model: req.model,
                messages: toOpenAiMessage(req.messages),
                tools: req.tools?.length? toOpenAiTool(req.tools) : undefined,
                stream: true,
                stream_options: { include_usage: true }
                
            }
            const res = await fetch(`${config.baseURL}/chat/completions`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${config.apiKey}`,
                    "Content-Type": "application/json",
                    ...(config.headers || {}),
                    
                },
                body: JSON.stringify(body)
                
            })
            if (!res.ok) throw new Error(`${config.name} ${res.status}: ${await res.text()}`);
            if (!res.body) throw new Error(`${config.name}: no body`);
            // 状态
            let accumulatedText = "";
            const toolCallsByIndex = new Map<number, {
                id: string;
                name: string;
                partialJson: string;
            }>();
            let stopReason: CompletionResponse["stopReason"] = "end_turn";
            let usage: CompletionResponse["usage"] | undefined;

            for await (const sse of iterateSse(res.body, req.signal)) {
                if (sse.data === "[DONE]") break;
                const chunk = JSON.parse(sse.data) as any;
                // usage 事件(choices 为空,usage 字段独立)
                if (chunk.usage && (!chunk.choices || chunk.choices.length === 0)) {
                    usage = {
                        inputTokens: chunk.usage.prompt_tokens ?? 0,
                        outputTokens: chunk.usage.completion_tokens ?? 0
                    }
                    continue
                }
                const choice = chunk.choices?.[0];
                if (!choice) continue
                const delta = choice.delta ?? {}
                // text_delta
                if (typeof delta.content === "string" && delta.content.length > 0) {
                    accumulatedText += delta.content
                    yield {type: "text_delta", delta: delta.content}
                }
                // tool_calls_delta
                if (Array.isArray(delta.tool_calls)) {
                    for (const tcDelta of delta.tool_calls) {
                        const idx = tcDelta.index
                        let exiting = toolCallsByIndex.get(idx);
                        // 第一次见这idx
                        if (!exiting) {
                            exiting = {id: tcDelta.id ?? "", name: tcDelta.function.name, partialJson: ""};
                            toolCallsByIndex.set(idx, exiting);
                            yield {type: "tool_use_start", index:idx, id:exiting.id, name: exiting.name}
                        }
                        // 累计argments
                        const argsFragment = tcDelta.function?.arguments;
                        if (typeof argsFragment === "string" && argsFragment.length > 0 ){
                            exiting.partialJson += argsFragment
                            yield {type: "tool_use_delta", index:idx,  deltaJson: argsFragment}
                        }
                    }
                }
                // finish_reason
                if (choice.finish_reason) {
                    stopReason = mapStopReason(choice.finish_reason);   // ← 翻译一次,存翻译后的
                    // finish 把所有累计的tool calls 收尾，parse json + yield too_use_end
                    for (const [idx, tc] of toolCallsByIndex){
                        let args : Record<string, unknown> = {}
                        try {
                            args = tc.partialJson ? JSON.parse(`${tc.partialJson}`) : {}
                        } catch {}
                        yield {type: "tool_use_end", index:idx, id:tc.id, name: tc.name, arguments: args}
                    }
                }
            }
            // 拼最终的message
            const toolCalls : ToolCall[] = []
            for (const [, tc] of toolCallsByIndex) {
                let args : Record<string, unknown> = {}
                try {
                    args = tc.partialJson ? JSON.parse(`${tc.partialJson}`) : {}
                } catch {}
                toolCalls.push({id: tc.id, name: tc.name, arguments: args})
            }
            // yield done
            yield {
                type: "done",
                message: { role: "assistant", content: accumulatedText, ...(toolCalls.length ? { toolCalls } : {})},
                stopReason: stopReason, 
                usage
            }
        }
        
    }
}



// const api = createOpenAiApi({
//     name: "DeepSeek",
//     baseURL: "https://api.deepseek.com",
//     apiKey: process.env.DEEPSEEK_API_KEY!,
// });
// const r = await api.complete({
//     model: "deepseek-v4-flash",
//     messages: [{ role: "user", content: "hi" }],
// });
// console.log(r);

// for await (const ev of api.stream({
//       model: process.env.MODEL,
//       messages: [{ role: "user", content: "用 bash 工具执行 ls" }],
//       tools: [{
//           name: "bash",
//           description: "run a bash command",
//           parameters: {
//           parameters: {
//               type: "object",
//               properties: { command: { type: "string" } },
//           case "stop": return "end_turn";
//           case "length": return "max_tokens";
//           case "tool_calls": return "tool_use";
//           case "content_filter": return "stop_sequence";
//           default: throw new Error(`Unknown finish_reason: ${fr}`);
//       }
//   }