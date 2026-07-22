import { defineTool, type Tool,tools, toolsByName,validateArgs } from "./tools.ts";
import { SessionStorage } from "../session/storage.ts";
import { createApi } from "../providers/factory.ts"
import {buildContext} from "../session/build.ts"
import type { Message } from "../providers/types.ts"
import type {HookRegistry} from "../hooks/registry.ts"
import { Type } from "typebox";

import { join } from "node:path";
import { mkdir } from "node:fs/promises";


function buildSubagentSystemPrompt(): string {
      return [
          // 角色定位
          "You are a subagent invoked by a parent agent to accomplish a " +
          "specific task. Your final assistant message is the return value " +
          "delivered back to the parent — it is NOT a message shown to a " +
          "human user. Structure it as a direct, self-contained answer.",

          // 规则
          [
              "Rules:",
              "- Complete the task fully before your final message.",
              "- Do not ask clarifying questions; make reasonable assumptions and note them in your answer.",
              "- After your final message, execution stops. There is no follow-up turn.",
              "- Tool calls made inside this subagent session are discarded after you return; only your final message is passed back.",
              "- Format your final message as a direct answer. Do not include meta-commentary like \"Here is my analysis\" or \"I have completed the task\".",
          ].join("\n"),

          // 任务
          `# Task`,
      ].join("\n\n");
  }

async function createSubAgentSession(parentSessionId: string, task:string) {
    const sessionDir = join(process.cwd(), ".sessions");
    await mkdir(sessionDir, { recursive: true });
    const sessionId = crypto.randomUUID();
    const filePath = join(sessionDir, `${parentSessionId}-sub-${sessionId}.jsonl`);
    const storage = await SessionStorage.create(filePath, { cwd: process.cwd() });
    // header
    await storage.appendMessage({ role: "system", content: buildSubagentSystemPrompt() });
    await storage.appendMessage({ role: "user", content: task })
    return storage

}

// subagent 内部,直接在自己的 callLLM 里用过滤后的 tools
const subagentTools = tools.filter(t => t.name !== "agent");

async function callLLM(messages:Message[], signal?:AbortSignal, model?:string) {
    const api = createApi()
    const response = await api.complete({
        model: model ?? process.env.MODEL ?? "deepseek-v4-flash",
        messages,
        tools: subagentTools,            // ← ← ← 只改这里
        signal,
    })
    return response.message
}

async function executeTool(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
): Promise<string> {
    const tool = toolsByName[name];
    if (!tool) return `ERROR: unknown tool: ${name}`;
    // 排除 subagent 自己不该用的 tool(比如 agent 递归)
    if (name === "agent") return `ERROR: subagent cannot invoke 'agent' tool`;
    try {
        const v = validateArgs(tool, args);
        if (!v.ok) return `ERROR: ${v.msg}`;
        return await tool.execute(args as never, { signal: signal ?? new AbortController().signal });
    } catch (e) {
        return `ERROR: ${(e as Error).message}`;
    }
}

     

async function agentLoop(storage: SessionStorage, hooks: HookRegistry, signal: AbortSignal, model?:string) : Promise<string>{
    while (true) {
        if (signal?.aborted) throw new Error("[subagent] aborted")
            const messages = await buildContext(storage.getEntries());
            const assistantMsg: Message = await callLLM(messages, signal, model);
            // 落盘
            await storage.appendMessage(assistantMsg)
            const toolCalls = assistantMsg.toolCalls || []
            if (toolCalls.length === 0) {
                return assistantMsg.content ?? ""
            }
            for (const tc of toolCalls) {
                const pre = await hooks.run("preToolUse", { toolName: tc.name, args: tc.arguments, storage: storage }, tc.name)
                if (pre.blocked) {
                    await storage.appendMessage({
                        role: "tool",
                        toolCallId: tc.id,
                        content: `ERROR: ${pre.reason ?? "denied by hook"}`,
                    });
                    continue;   // 继续下一个 toolCall,不 execute
                }
                const finalArgs = pre.ctx.args
                const result = await executeTool(tc.name, finalArgs, signal)
                // ── post hook ──
                const post = await hooks.run(
                    "postToolUse",
                    { toolName: tc.name, args: finalArgs, result: result ?? "", storage },
                    tc.name,
                );
                const finalResult = post.ctx.result;
                await storage.appendMessage({
                    role: "tool",
                    toolCallId: tc.id,
                    content: finalResult,
                });
            }
    }
}

export function createAgentTool(deps: {
    parentSessionId: string;
    hooks: HookRegistry
}): Tool<any> {

    return defineTool({
        name: "agent",
        description: "Delegate a self-contained task to a subagent with its own " + "context and session. Use for tasks that would bloat the " +
                   "main context (deep research, multi-file exploration).",
        parameters: Type.Object({
            task: Type.String({ description: "Clear, self-contained task description. " +
                        "The subagent will not see your conversation history" }),
            model: Type.Optional(Type.String({ description: "Model override for the subagent (defaults to main agent's model)" })),
        }),
        execute: async (args, ctx) => {
            const storage = await createSubAgentSession(deps.parentSessionId, args.task)
            return await agentLoop(storage, deps.hooks, ctx.signal, args.model);
        },
    });
}
