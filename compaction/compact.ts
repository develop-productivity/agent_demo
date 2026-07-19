import type { Api, Message } from "../providers/types";
import type { SessionEntry, MessageEntry } from "../session/types";
import type { SessionStorage } from "../session/storage";
import { buildContext } from "../session/build";

const COMPACTION_THRESHOLD = Number(process.env.COMPACTION_THRESHOLD) || 128_000;
const KEEP_LAST_TURNS = 2;

// ---- 工具函数 1：估 token ----
// function estimateTokens(messages: Message[]): number {
//     // TODO: 真正的实现要用 LLM 去估，这里简化一下就直接数字符了…
//     return  

// }

// ---- 工具函数 1：估 token ----
function estimateChars(messages: Message[]): number {
    // TODO: 真正的实现要用 LLM 去估，这里简化一下就直接数字符了…
    let total = 0
    for (const m of messages) {
        if (typeof m.content === "string") total += m.content.length
        if (m.role === "assistant" && m.toolCalls) {
            for (const tc of m.toolCalls) {
                total += tc.name.length;
                total += JSON.stringify(tc.arguments).length;
            }
        }
    }
    return total;
}

// ---- 工具函数 2：把 messages 拍成纯文本给摘要器读 ----
function formatMessages(messages: Message[]): string {
    const lines :string[] = [];
    for (const m of messages){
        switch (m.role) {
            case "system": lines.push(`[SYSTEM]\n${m.content}`); break;
            case "user": lines.push(`[USER]\n${m.content}`); break;
            case "assistant":{
                const parts: string[] = [];
                if (m.content) parts.push(m.content)
                if (m.toolCalls?.length) {
                    for (const tc of m.toolCalls) {
                        parts.push(`<tool_call name="${tc.name}" id="${tc.id}">${JSON.stringify(tc.arguments)}</tool_call>`)
                    }
                }
                lines.push(`[ASSISTANT]\n${parts.join("\n")}`);
                break;
            }
            case "tool": lines.push(`[TOOL_RESULT id="${m.toolCallId}"]\n${m.content}`); break;
        }   
    }
    return lines.join("\n\n");
}

// ---- 工具函数 3：调 LLM 生成摘要 ----
const SUMMARY_SYSTEM_PROMPT = `You are a context summarization assistant. Read the conversation below and produce a structured summary. Do NOT continue the conversation. Only output the summary.
        Format:
        ## Goal
        [What is the user trying to accomplish?]

        ## Progress
        - [x] [Completed]
        - [ ] [In progress]

        ## Key Decisions
        - [Decision]: [Rationale]

        ## Next Steps
        1. [What should happen next]

        ## Critical Context
        - [File paths, function names, error messages worth preserving]

        Keep it concise. Preserve exact file paths and error strings.`;
async function summarize(api: Api, messages: Message[]): Promise<string> {
    const conversionText = formatMessages(messages);
    const prompt : Message[] = [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: `<conversation>\n${conversionText}\n</conversation>\n\n\nSummarize this conversation.`},
    ];
    const resp = await api.complete({
        model: process.env.MODEL ?? "deepseek-v4-flash",
        messages: prompt,
    });
    const summary = resp.message.content?.trim();
    if (!summary) {
          throw new Error(`summarize returned empty content (stopReason=${resp.stopReason})`);
      }
    return summary;
}

// intry index
function findCutIndex(entries: SessionEntry[], keepTurns: number):number {
    let userSeen = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
        //TS 的类型窄化(control flow narrowing)只对同一个引用有效。entries[i] 每次求值 TS 都当成全新的 SessionEntry,只有把结果绑到 const e 上,窄化才会保留
        const e = entries[i]
        if (e.type !== "message") continue;
        if (e.message.role === "user") {
            userSeen++;
            if (userSeen === keepTurns) return i;
        }
    }
    return -1;
}

export async function mabeCompact(
    api: Api,
    storage: SessionStorage,
) : Promise<void> {
    // 1. 拿 entries → buildContext → messages
    // 2. estimateTokens < THRESHOLD → return
    // 3. 从后往前扫 entries 找第 2 个 user message → firstKeptId
    // 5. entries.slice(0, firstKeptIndex) filter message → toSummarize
    // 6. summary = await summarize(api, toSummarize)   (try/catch)
    // 7. storage.appendEntry({ type: "compaction", ...})
    const entries = storage.getEntries();
    const currentMessages = buildContext(entries);
    const chars = estimateChars(currentMessages);
    if (chars < COMPACTION_THRESHOLD) return;
    const cutIndex = findCutIndex(entries, KEEP_LAST_TURNS);
    if (cutIndex <= 0) return 
    let boundaryStart = 0;
    for (let i = cutIndex - 1; i >= 0; i--) {
        if (entries[i].type === "compaction"){
            boundaryStart = i + 1;
            break;
        }
    }
    //,TS 认为返回类型还是原 union 的数组，因此应该加上类型谓词
    const toSummarize: Message[] = entries.slice(boundaryStart, cutIndex).filter((e): e is MessageEntry=> e.type === "message").map(e => e.message);
    if (toSummarize.length === 0) return 
    let summary:string;
    try {
        summary = await summarize(api, toSummarize);
    } catch (error) {
        console.error("Summarization failed:", (error as Error).message);
        return 
    }
    // append 一条
    const firstKeptEntry = entries[cutIndex];
    if (!firstKeptEntry?.id) {
        throw new Error(`cutIndex ${cutIndex} has no valid entry id`);
    }
    await storage.appendEntry({
        type: "compaction",
        id: crypto.randomUUID(),
        timestamp: Date.now().toString(),
        summary: summary,
        firstKeptEntryId: firstKeptEntry.id,
        tokensBefore: chars
    })
    console.log(`[compaction] compacted ${toSummarize.length} messages ${chars} chars → summary ${summary.length} chars.`);
}
