import type { CompletionRequest, CompletionResponse, Api, Message, Tool, ToolCall, StreamEvent } from "./types";
import {iterateSse} from "./sse"
import { Record, type TSchema } from "typebox";

export interface AnthropicConfig {
    name: string;
    apiKey: string;
    baseURL: string;
    version: string;
    max_tokens?: number;
    headers?: Record<string, string>;
}



function mapStopReason(reason: AnthropicResponse["stop_reason"]):       CompletionResponse["stopReason"] {
    switch (reason) {
        case "max_tokens":
            return "max_tokens";
        case "tool_use":
            return "tool_use";
        case "end_turn":
            return "end_turn";
        case "stop_sequence":
            return "stop_sequence";
        default:
            return "error";
    }
}

interface AnthropicTextBlock {
    type: "text";
    text: string;
}

interface AnthropicToolUseBlock {
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, unknown>;  // 是对象，不是字符串
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;
export interface AnthropicResponse {
    content: AnthropicContentBlock[];  // 这里用联合类型
    usage: { input_tokens: number; output_tokens: number };
    type: "message";
    role: "assistant";
    stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "pause_turn" |null;
    id: string;
}

interface AnthropicToolDef {
    name: string;
    description: string;
    // input_schema: Record<string, unknown>;  // JSON Schema 对象
    input_schema: TSchema;
}

function toAnthropicTools(tools: Tool[]): AnthropicToolDef[] {
    return tools.map(t => {
        let inputSchema: TSchema;
        try {
            inputSchema = t.parameters;
        } catch {
            inputSchema = { type: "object", properties: {} };
        }
        return {
            name: t.name,
            description: t.description,
            input_schema: inputSchema,
        };
    });
}


function mapToolCall(block: AnthropicToolUseBlock): ToolCall {
    return {
        id: block.id,
        name: block.name,
        arguments: block.input,  // 已经是对象，不用 JSON.parse
    };
}

function fromAnthropicResponse(response: AnthropicResponse): CompletionResponse {
    const textBlocks = response.content
          .filter((b): b is AnthropicTextBlock => b.type === "text")
          .map(b => b.text)
          .join("");
    const toolUseBlocks = response.content.filter(
          (b): b is AnthropicToolUseBlock => b.type === "tool_use"
      );
    return {
        message: {
            role: "assistant" as const,
            content: textBlocks,
            ...(toolUseBlocks.length > 0
                  ? { toolCalls: toolUseBlocks.map(mapToolCall) }
                  : {})
        },
        stopReason: mapStopReason(response.stop_reason),
        usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens
        }
    }
}

function toAnthropicMessages(messages: Message[]):{ system?: string; messages: Array<{ role: "user" | "assistant"; content: unknown }> } {
    const system = messages
        .filter(m => m.role === "system")
        .map(m => m.content)
        .join("\n\n") || undefined;
    const out: Array<{ role: "user" | "assistant"; content: unknown }> = [];
    for (const m of messages) {
        if (m.role === "user") {
            out.push({ role: "user", content: m.content });
        } else if (m.role === "assistant") {
            if (m.toolCalls?.length) {
                // 有工具调用
                const blocks:(AnthropicTextBlock | AnthropicToolUseBlock)[] = [];
                if (m.content) blocks.push({type:"text", text:m.content})
                for (const tc of m.toolCalls){
                    blocks.push({type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments})
                }
                out.push({ role: "assistant", content: blocks });
            } else {
                out.push({ role: "assistant", content: m.content ?? "" });
            }
        } else if (m.role === "tool") {
            // tool 结果包在 user 消息里
            out.push({ role: "user", content: [
                {
                    type: "tool_result",
                    tool_use_id: m.toolCallId,
                    content: m.content
                }
            ] });
        } else if (m.role === "system") {
            // system 消息已在上面提取到顶层 system 字段，这里跳过
        } else {
          const _exhaustive: never = m;
          throw new Error(`Unknown message: ${JSON.stringify(m)}`);
      }
    }
    return { system, messages: out };
}


const ANTHROPIC_EVENTS = new Set([
    "message_start",
    "content_block_start",
    "content_block_delta",
    "content_block_stop",
    "message_delta",
    "message_stop",
]);

async function* iterateAnthropicEvents(
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal
) : AsyncGenerator<any>{
    for await (const sse of iterateSse(body, signal)) {
        if (!ANTHROPIC_EVENTS.has(sse.event)) continue;   // 白名单过滤
        yield JSON.parse(sse.data);                        // 简单直接， 返回的是data
    }
}

export function createAnthropicApi(config: AnthropicConfig): Api {
    return {
        name: config.name,
        async complete(req: CompletionRequest): Promise<CompletionResponse> {
            const { system, messages } = toAnthropicMessages(req.messages);
            const body = {
                model: req.model,
                max_tokens: config.max_tokens ?? 4096,
                messages,
                stream: true,   // ← 加这行
                ...(system ? { system } : {}),
                ...(req.tools?.length ? { tools: toAnthropicTools(req.tools) } : {})
            }
            const res = await fetch(`${config.baseURL}/v1/messages`,{
                method: "POST",
                headers: {
                    "x-api-key":config.apiKey,
                    "Content-Type": "application/json",
                    "anthropic-version": config.version ?? "2023-06-01",
                    ...(config.headers || {})
                },
                body: JSON.stringify(body),
                signal: req.signal
            });
            if (!res.ok) {throw new Error(`${config.name}: ${res.status} ${await res.text()}`)}
            return fromAnthropicResponse(await res.json() as AnthropicResponse)
        },
        async *stream(req: CompletionRequest): AsyncIterable<StreamEvent> {
            const { system, messages } = toAnthropicMessages(req.messages);
            const body = {
                model: req.model,
                max_tokens: config.max_tokens ?? 4096,
                messages,
                stream: true,
                ...(system ? { system } : {}),
                ...(req.tools?.length ? { tools: toAnthropicTools(req.tools) } : {}),
            }
            const res = await fetch(`${config.baseURL}/v1/messages`,{
                method: "POST",
                headers: {
                    "x-api-key":config.apiKey,
                    "Content-Type": "application/json",
                    "anthropic-version": config.version ?? "2023-06-01",
                    ...(config.headers || {})
                },
                body: JSON.stringify(body),
                signal: req.signal
            });
            if (!res.ok) throw new Error(`... ${res.status} ${await res.text()}`);
            if (!res.body) throw new Error("no body");
            // 状态 A: index → 当前 block 的信息
            const blocks = new Map<number, 
                | {kind: "text"; text: string}
                | {kind: "tool_use"; id: string; name: string; partialJson: string }>();

            //状态 B: 最终 message 的组装容器
            let accumulatedText = "";
            const toolCalls: ToolCall[] = [];
            let stopReason: CompletionResponse["stopReason"] = "end_turn";
            let usage: CompletionResponse["usage"] | undefined
            // 循环读取 events
            for await (const event of iterateAnthropicEvents(res.body, req.signal)) {
                // 翻译 组装                
                switch (event.type) {
                    case "message_start":
                        // 提取 usage(可选,message_delta 那边会覆盖)
                       if (event.message.usage) {
                           usage = {inputTokens: event.message.usage.input_tokens ?? 0, outputTokens: event.message.usage.output_tokens ?? 0 };
                       }
                       break;
                    case "content_block_start":{
                        //       * text → blocks.set,不 yield
                        //       * tool_use → blocks.set,yield tool_use_start
                        const cb = event.content_block;
                        if (cb.type === "text") {
                            blocks.set(event.index, {kind: "text", text: ""});
                        } else if (cb.type === "tool_use") {
                            blocks.set(event.index, {kind: "tool_use", id: cb.id, name: cb.name, partialJson: ""});
                            yield {type: "tool_use_start", index: event.index, id: cb.id, name: cb.name }
                        }
                        // 其他类型(thinking / redacted_thinking) 忽略
                        break;
                    }
                    case "content_block_delta": {
                        // * text_delta → 更新 blocks,yield text_delta,accumulatedText 累加
                        // * input_json_delta → 更新 blocks.partialJson,yield tool_use_delta
                        const block = blocks.get(event.index);
                        if (!block) break;
                        if (event.delta.type === "text_delta" && block.kind === "text") {
                            block.text += event.delta.text;
                            accumulatedText += event.delta.text;
                            yield {type: "text_delta", delta: event.delta.text}
                        } else if (event.delta.type === "input_json_delta" && block.kind === "tool_use") {
                            block.partialJson += event.delta.partial_json
                            yield {type: "tool_use_delta", index:event.index, deltaJson: event.delta.partial_json}
                        }
                        break;
                    }
                    case "content_block_stop":{
                        const block = blocks.get(event.index);
                        if (!block) break;
                        if (block.kind === "tool_use") {
                            let args : Record<string, unknown> = {}
                            try {
                                args = block.partialJson ? JSON.parse(block.partialJson) : {}
                            } catch {}
                            toolCalls.push({id: block.id, name:block.name, arguments: args});
                            yield {type: "tool_use_end", index: event.index, id: block.id, name: block.name, arguments:args}
                        }
                        blocks.delete(event.index) // 清除当前 block
                        break;
                    }
                    case "message_delta":
                        //   - message_delta: 更新 stopReason 和 usage
                        if (event.delta?.stop_reason) {
                            stopReason = mapStopReason(event.delta.stop_reason);
                        }
                        if (event.usage?.output_tokens != null && usage) {
                            usage.outputTokens = event.usage.output_tokens ?? 0
                        }
                        break;
                    case "message_stop":
                        //   - message_stop: 什么都不做(循环结束后统一 yield done)
                        break;
                }
            }
            yield {
                    type: "done",
                    message: {
                        role: "assistant",
                        content: accumulatedText,
                        ...(toolCalls.length ? { toolCalls } : {}),
                    },
                    stopReason,
                    usage,
            };
        }
    }
}
