import { HookRegistry } from "./hooks/registry.ts";
import { registerBuiltinHooks } from "./hooks/builtin.ts";
import { toolsByName, tools, type Tool } from "./tools.ts";   // tools.ts 记得 export toolsByName
import { confirm } from "./utils.js";
import readline from "node:readline";
import { join } from "node:path";

import { Compile } from "typebox/compile";
import { Value } from "typebox/value";

import { createOpenAiApi } from "./providers/openai.ts"
import { createAnthropicApi } from "./providers/anthropic.ts"
import type { Api, Message } from "./providers/types.ts"
import type { TSchema,Static } from "typebox";

import { SessionStorage } from "./session/storage.ts";
import { buildContext } from "./session/build.ts";
import {mabeCompact} from "./compaction/compact.ts";
import { mkdir } from "node:fs/promises";


function createApi(): Api {
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
    
const validatorCache = new WeakMap();

function validateArgs(tool: Tool<TSchema>, rawArgs: Record<string, unknown>) {
    const args = structuredClone(rawArgs);
    Value.Convert(tool.parameters, args);
    let v = validatorCache.get(tool.parameters);
    if (!v) { v = Compile(tool.parameters); validatorCache.set(tool.parameters, v); }
    if (v.Check(args)) return { ok: true, args };
    const errs = v.Errors(args).map(e => `  - ${e.instancePath || "root"}: ${e.message}`).join("\n");
    return { ok: false, msg: `Validation failed:\n${errs}` };
}

// async function beforeToolCall(name: string, args:Record<string, unknown>, rl: readline.Interface) {
//     if (name === "bash")       return await confirm(rl, `run: ${args.command}?`);
//     if (name === "write_file") return await confirm(rl, `write ${args.path}?`);
//     if (name === "edit_file")  return await confirm(rl, `edit ${args.path}?`);
//     return true;  // read_file / get_current_time 免确认
// }


async function executeTool(name: string, args: Record<string, unknown>, signal: AbortSignal) {
    const tool = toolsByName[name];
    if (!tool) return `ERROR: unknown tool: ${name}`;
    try {
        const v = validateArgs(tool, args);
        if (!v.ok) return `ERROR: ${v.msg}`;
        return await tool.execute(v.args as never, { signal });
        // return await tool.execute(args, { signal });
    } catch (e) {
        return `ERROR: ${e.message}`;
    }
}

async function callLLM(messages: Message[], signal?: AbortSignal){
    const api = createApi()
    const response = await api.complete({
        model: process.env.MODEL || "deepseek-v4-flash",
        messages,
        tools: tools,
        signal: signal,
    })
    return response.message
}

async function callLLMStream(messages: Message[], signal?: AbortSignal) {
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

async function appendMessage(storage: SessionStorage, message: Message): Promise<void> {
    await storage.appendEntry({
        type: "message",
        id: crypto.randomUUID(),
        timestamp: Date.now().toString(),
        message
    })
}

let currentTurnAbort: AbortController | null = null;   // module-level：当前 turn 的 controller

async function runAgent(storage: SessionStorage, rl: readline.Interface, hooks: HookRegistry) {
    // turn 级 AbortController：Ctrl+C 只中止本轮
    const ac = new AbortController();
    currentTurnAbort = ac;
    try {
        while (true) {
            if (ac.signal.aborted) {
                console.log("[turn aborted]\n");
                return;
            }
            await mabeCompact(createApi(), storage);
            const messages = await buildContext(storage.getEntries());
            // const assistantMsg: Message = await callLLM(messages, ac.signal);
            // stream 效果
            const assistantMsg: Message = await callLLMStream(messages, ac.signal);
            await appendMessage(storage, assistantMsg);
            const toolCalls = assistantMsg.toolCalls || [];
            if (toolCalls.length === 0) {
                // stream 已经输出了，因此注释掉
                // console.log(`Assistant: ${assistantMsg.content}\n`);
                return;
            }
            for (const tc of toolCalls) {
                const args = tc.arguments;
                const pre = await hooks.run("preToolUse", { toolName: tc.name, args: args, storage: storage }, tc.name);
                if (pre.blocked) {
                    await appendMessage(storage, { role: "tool", toolCallId: tc.id, content: `ERROR: ${pre.reason ?? "denied"}` });
                }
                const final_args = pre.ctx.args;  
                const toolResult = await executeTool(tc.name, final_args, ac.signal);
                const post = await hooks.run("postToolUse", { toolName: tc.name, args: final_args, result: toolResult ?? "", storage: storage }, tc.name);
                const finalResult = post.ctx.result;
                // console.log(`▸ ${tc.name}(${tc.arguments}) → ${finalResult}`);
                await appendMessage(storage, {
                    role: "tool",
                    toolCallId: tc.id,
                    content: finalResult,
                });
            }
        }
    } finally {
        // process.off("SIGINT", onSigint);
        currentTurnAbort = null;
    }
}

function printResumeHint(id: string, isNew: boolean): void {
    console.log(`${isNew ? "New" : "Resumed"} session: ${id}`);
    console.log(`Resume with: npx tsx agent.ts --resume ${id}`);
}

async function createSession(hooks: HookRegistry): Promise<{ storage: SessionStorage;extras: string[] }>{
    const resumeId = process.argv[2] === "--resume" ? process.argv[3] : undefined;
    const sessionDir = join(process.cwd(), "sessions");
    await mkdir(sessionDir, { recursive: true });
    const sessionId = resumeId ?? crypto.randomUUID();
    const filePath = join(sessionDir, `${sessionId}.jsonl`);
     const extras: string[] = []
    if (resumeId) {
        const storage = await SessionStorage.open(filePath);
        printResumeHint(sessionId, false);
        return {storage, extras};
    }
    const storage = await SessionStorage.create(filePath, { cwd: process.cwd() });

    await hooks.run("sessionStart", { storage, systemPromptExtras:extras });
    const systemContent = [
        "You are a helpful assistant. Use the provided tools when you need to look up information, run commands, or read/write files. Otherwise respond directly.",
        ...extras,
    ].join("\n\n");
    await storage.appendEntry({
        type: "message",
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        message: { role: "system", content: systemContent},
    });
    printResumeHint(sessionId, true);
    return {storage, extras};
}

async function main() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const hooks = new HookRegistry();
    registerBuiltinHooks(hooks, rl);
    const {storage, extras}= await createSession(hooks);
    let lastSigintAt = 0;
    rl.on("SIGINT", () => {
        const now = Date.now();
        if (currentTurnAbort) {
            if (now - lastSigintAt < 1000) {
                console.log("\n[SIGINT x2] force exit");
                printResumeHint(storage.getMetadata().id, false);
                process.exit(138);  // 138 = SIGINT exit status
            }
            lastSigintAt = now;
            console.log("\n[SIGINT] aborting current turn...(Ctrl+C again to force exit)");
            currentTurnAbort.abort();
        } else {
            console.log("exit\n");
            printResumeHint(storage.getMetadata().id, false);
            rl.close();
            process.exit(0);
        }
    });
    while (true) {
        // const line = await new Promise((r) => rl.question("User: ", r));
        const line = await new Promise<string>((r) => rl.question("User: ", r));
        if (!line || line === "exit") {
            printResumeHint(storage.getMetadata().id, false);
            break;
        };
        const pre = await hooks.run("userPromptSubmit", {input: line.trim(), storage})
        if (pre.blocked) {
            console.log(`[blocked] ${pre.reason}\n`);
            continue;
        }
        const finalInput = pre.ctx.input
        await appendMessage(storage, {
            role: "user",
            content: finalInput,
        });
        await runAgent(storage, rl, hooks);
    }
    rl.close();
}

main();
