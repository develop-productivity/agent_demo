import type { TSchema } from "typebox";
export type ContentPart = 
    | { type: "text"; text: string }
    | { type: "image"; url: string };   // 占位，Day 6 再启用
    
export type Content = string | ContentPart[];   // ← 起步 union

export interface Tool {
    name: string;
    description: string;
    parameters: TSchema;
}

export type Message =
    | { role: "system"; content: string }
    | { role: "user"; content: string }
    | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
    | { role: "tool"; toolCallId: string; content: string; isError? :boolean };


export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface CompletionRequest {
    model: string,
    messages: Message[],
    tools?: Tool[],
    signal?: AbortController['signal']
}

export interface CompletionResponse {
    message: {
        role: "assistant";
        content: string;
        toolCalls?: ToolCall[];
    };
    stopReason : "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "error";
    usage? : {inputTokens: number; outputTokens: number}
}

export interface Api {
    name: string;
    complete(req: CompletionRequest) : Promise<CompletionResponse>;
    stream(req: CompletionRequest) : AsyncIterable<StreamEvent>;
}

export type StreamEvent =
    | { type: "text_delta"; delta: string }
    | { type: "tool_use_start"; index: number; id: string; name: string }
    | { type: "tool_use_delta"; index: number; deltaJson: string }
    | { type: "tool_use_end"; index: number; id: string; name: string; arguments: Record<string, unknown> }
    | { type: "done";
        message: CompletionResponse["message"];
        stopReason: CompletionResponse["stopReason"];
        usage?: CompletionResponse["usage"] };