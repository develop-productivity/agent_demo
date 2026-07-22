import { createOpenAiApi } from "./openai.ts";
import type { Message, Tool } from "./types.ts";

async function testText() {
    console.log("\n=== TEST 1: 纯文本 ===\n");
    const api = createOpenAiApi({
        name: process.env.PROVIDER || "openai",
        baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.openai.com",
        apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
    });

    const messages: Message[] = [
        { role: "user", content: "用中文说'你好',就三个字,不要别的" },
    ];

    for await (const ev of api.stream({
        model: process.env.MODEL || "deepseek-v4-flash",
        messages,
    })) {
        console.log(JSON.stringify(ev));
    }
}

async function testTool() {
    console.log("\n=== TEST 2: 工具调用 ===\n");
    const api = createOpenAiApi({
        name: process.env.PROVIDER || "openai",
        baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.openai.com",
        apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
    });

    const messages: Message[] = [
        { role: "user", content: "用 bash 工具执行 ls 命令" },
    ];

    const tools: Tool[] = [{
        name: "bash",
        description: "run a bash command and return stdout",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "shell command" },
            },
            required: ["command"],
        } as any,
    }];

    for await (const ev of api.stream({
        model: process.env.MODEL || "deepseek-v4-flash",
        messages,
        tools,
    })) {
        console.log(JSON.stringify(ev));
    }
}

async function main() {
    await testText();
    await testTool();
}

main().catch(err => {
    console.error("SMOKE TEST FAILED:", err);
    process.exit(1);
});