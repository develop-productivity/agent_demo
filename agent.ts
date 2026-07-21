import { HookRegistry } from "./hooks/registry";
import { registerBuiltinHooks } from "./hooks/builtin";
import { toolsByName, validateArgs, registerTool } from "./tools/tools"
import readline from "node:readline";
import { join } from "node:path";
import type { Message } from "./providers/types"
import { SessionStorage } from "./session/storage";
import { buildContext } from "./session/build";
import {mabeCompact} from "./compaction/compact";
import { mkdir } from "node:fs/promises";
import {loadSkills, Skill, createReadSkillTool} from "./skills";
import { callLLMStream, createApi } from "./providers/factory";
import { createAgentTool } from "./tools/agent-tools"
import {loadPermissionEngine} from "./permissions/engine"



async function executeTool(name: string, args: Record<string, unknown>, signal: AbortSignal) {
    const tool = toolsByName[name];
    if (!tool) return `ERROR: unknown tool: ${name}`;
    try {
        const v = validateArgs(tool, args);
        if (!v.ok) return `ERROR: ${v.msg}`;
        return await tool.execute(v.args as never, { signal });
        // return await tool.execute(args, { signal });
    } catch (e) {
        return `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }
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
            await storage.appendMessage(assistantMsg);
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
                    await storage.appendMessage({ role: "tool", toolCallId: tc.id, content: `ERROR: ${pre.reason ?? "denied"}` });
                    continue;
                }
                const final_args = pre.ctx.args;  
                const toolResult = await executeTool(tc.name, final_args, ac.signal);
                const post = await hooks.run("postToolUse", { toolName: tc.name, args: final_args, result: toolResult ?? "", storage: storage }, tc.name);
                const finalResult = post.ctx.result;
                // console.log(`▸ ${tc.name}(${tc.arguments}) → ${finalResult}`);
                await storage.appendMessage({
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
    const sessionDir = join(process.cwd(), ".sessions");
    await mkdir(sessionDir, { recursive: true });
    const sessionId = resumeId ?? crypto.randomUUID();
    const filePath = join(sessionDir, `${sessionId}.jsonl`);
     const extras: string[] = []
    if (resumeId) {
        const storage = await SessionStorage.open(filePath);
        printResumeHint(sessionId, false);
        return {storage, extras};
    }
    const storage = await SessionStorage.create(filePath, { cwd: process.cwd(), id: sessionId });

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
    const engine = await loadPermissionEngine(".permission.json");
    registerBuiltinHooks(hooks, rl, engine);
    const skillDir = './skills';
    const skills: Skill[] = await loadSkills(skillDir);
    if (skills.length > 0) {console.log(`[skills] load ${skills.length} skills`);}
    // skills as tools
    registerTool(createReadSkillTool(skills));
    // Register agent tool with parent session ID and hooks
    const {storage, extras}= await createSession(hooks);
    registerTool(createAgentTool({ parentSessionId: storage.getMetadata().id, hooks }));
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
        await storage.appendMessage({
            role: "user",
            content: finalInput,
        });
        await runAgent(storage, rl, hooks);
    }
    rl.close();
}

main();
