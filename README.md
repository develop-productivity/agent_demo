# Agent Demo

一个手写的 TypeScript Agent 框架学习项目 —— 从零复刻一个类 Claude Code 的命令行 Agent,用于理解 agent loop、tool calling、session、hooks、streaming 等核心机制。

支持 Anthropic 和 OpenAI 兼容协议(DeepSeek 等),流式打字机效果,可持久化会话。

## 项目结构

```
agent_demo/
├── agent.ts                # 主程序:REPL 循环 + agent 主控
├── tools.ts                # 4 个内置工具 (bash / read_file / write_file / get_current_time)
├── providers/              # Provider 抽象 —— 隔离底层 LLM 差异
│   ├── types.ts            # Api 接口 / Message / StreamEvent 等协议类型
│   ├── openai.ts           # OpenAI / DeepSeek 兼容实现 (complete + stream)
│   ├── anthropic.ts        # Anthropic 实现 (complete + stream)
│   └── sse.ts              # 通用 SSE 解析器 (iterateSse)
├── session/                # 会话持久化
│   ├── types.ts            # SessionEntry / SessionMetadata
│   ├── storage.ts          # JSONL append-only 存储
│   └── build.ts            # 从 entries 重建 messages 上下文
├── compaction/
│   └── compact.ts          # 上下文过长时的自动压缩
├── hooks/                  # 生命周期钩子系统
│   ├── types.ts            # HookKind / HookResult / Entry
│   ├── registry.ts         # 列表式 hook 注册器 + matcher
│   └── builtin.ts          # 内置 hook (工具确认 / 敏感文件保护等)
├── learn_note/             # 逐日学习笔记 day-1 ~ day-8
├── sessions/               # 运行时会话文件 (每个 session 一个 .jsonl)
├── utils.js                # confirm() 等小工具
├── package.json
└── README.md
```

## 已完成的能力 (Day 1 - Day 8)

| 阶段 | 主题 | 关键模块 |
|---|---|---|
| Day 1 | Agent Loop + Tool Calling | `agent.ts` / `tools.ts` |
| Day 2 | Provider 抽象层 | `providers/types.ts` / `providers/openai.ts` |
| Day 3 | Anthropic Provider + 类型收窄 | `providers/anthropic.ts` |
| Day 4 | Tool 参数校验 (Typebox) | `tools.ts` 里的 TSchema |
| Day 5 | Session 持久化 (JSONL append-only) | `session/storage.ts` / `session/build.ts` |
| Day 6 | Compaction (上下文自动压缩) | `compaction/compact.ts` |
| Day 7 | Hooks 系统 (sessionStart / userPromptSubmit / preToolUse / postToolUse) | `hooks/*` |
| Day 8 | **Streaming (SSE + AsyncGenerator + 打字机效果)** | `providers/sse.ts` + 两家 provider 的 `stream()` |

详细的分日学习笔记见 [`learn_note/`](./learn_note/) 目录。

## Streaming 架构 (Day 8 新增)

采用**四层翻译管线**,每层只做一次形状变换,上层不认识下层的私有概念:

```
callLLM (agent.ts)                                <-- 消费者
    ↕  for await StreamEvent
providers/{openai,anthropic}.ts 的 stream()        <-- 第 3 层:业务事件
    ↕  逐个消费 provider 原生事件
iterateAnthropicEvents / OpenAI chunk parse       <-- 第 2 层:协议事件 (JSON 对象)
    ↕  for await SseEvent
providers/sse.ts 的 iterateSse()                  <-- 第 1 层:传输格式 (字符串对)
    ↕  ReadableStream<Uint8Array>
fetch(...).body                                   <-- 网络字节流
```

**统一事件协议 `StreamEvent`**(见 `providers/types.ts`),两家 provider 都翻译到这个协议:

```ts
type StreamEvent =
    | { type: "text_delta"; delta: string }
    | { type: "tool_use_start"; index: number; id: string; name: string }
    | { type: "tool_use_delta"; index: number; deltaJson: string }
    | { type: "tool_use_end"; index: number; id: string; name: string; arguments: Record<string, unknown> }
    | { type: "done"; message: ...; stopReason: ...; usage?: ... };
```

`agent.ts` 的 `callLLM` 通过 `for await (const ev of api.stream(...))` 逐事件消费,
`text_delta` 直接 `process.stdout.write` 实现打字机,`tool_use_end` 拿完整 arguments 执行工具,
`done` 拿最终 message 存 session。**agent.ts 完全不知道底下是 OpenAI 还是 Anthropic**。

## 使用

### 前置条件

- Node.js 20+ (原生 ESM + `tsx` 运行 `.ts` 文件)
- 至少配好一家 provider 的环境变量

### 环境变量

```bash
# 选一家 provider (默认 anthropic)
export PROVIDER=anthropic          # 或 openai / deepseek

# Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."

# OpenAI / DeepSeek 兼容
export DEEPSEEK_API_KEY="sk-..."
export DEEPSEEK_BASE_URL="https://api.deepseek.com"   # 可选,默认 https://api.openai.com

# 模型 id
export MODEL="claude-3-5-sonnet-latest"   # 或 deepseek-chat / deepseek-v4-flash 等
```

### 启动

```bash
cd /Users/dongshiyin.1/Code/agents/pi/agent_demo

# 新会话
npx tsx agent.ts

# 恢复历史会话
npx tsx agent.ts --resume <session-id>
```

### 使用示例

```
User: 你好,请数到 3
Assistant: 1, 2, 3

User: 用 bash 工具列出当前目录
[调用 bash...]
Assistant: 当前目录包含 agent.ts, compaction, hooks 等文件。

User: exit
Resume with: npx tsx agent.ts --resume <session-id>
```

## 内置工具

| 工具名 | 功能 | 参数 | 需要确认 |
|---|---|---|---|
| `get_current_time` | 获取当前时间 | 无 | 否 |
| `read_file` | 读取文件内容(限制 1KB) | `path` | 否 |
| `bash` | 执行 bash 命令 | `command` | ✅ (通过 preToolUse hook) |
| `write_file` | 写入文件 | `path`, `content` | ✅ (通过 preToolUse hook) |

工具参数使用 [Typebox](https://github.com/sinclairzx81/typebox) 定义 schema,
调用前自动校验并转换(如 `"true"` → `true`)。

## 核心 Agent Loop

```
main REPL:
  while (true) {
      读一行用户输入
      过 userPromptSubmit hook (可拒绝 / 改写)
      写入 session (role: "user")
      runAgent()
  }

runAgent():
  while (true) {
      maybeCompact()                            # 上下文过长则压缩
      messages = buildContext(entries)          # 从 session 重建
      assistantMsg = callLLM(messages, signal)  # 流式:边收边打字机
      写入 session (role: "assistant")
      if (assistantMsg.toolCalls.length === 0) return   # 没工具 → 本轮结束
      for (tc of toolCalls) {
          过 preToolUse hook (确认 / 拒绝 / 改参数)
          执行工具
          过 postToolUse hook (改结果 / 打日志)
          写入 session (role: "tool")
      }
  }
```

## Hooks 系统

4 个生命周期节点,列表式注册,按顺序执行:

- `sessionStart` —— 会话创建后,可注入 systemPromptExtras
- `userPromptSubmit` —— 用户输入 → 执行前,可拒绝或改写
- `preToolUse` —— 工具执行前,可确认 / 拒绝 / 改参数 (匹配 toolName)
- `postToolUse` —— 工具执行后,可改结果 / 打日志

Hook 返回 `HookResult<C>` 三种能力:

- 观察 (return void)
- 拒绝 (return `{ block: true, reason }`)
- 修改上下文 (return `{ ctx: newCtx }`)

## Session

**JSONL append-only** 存储在 `sessions/<uuid>.jsonl`,每行一条 entry(消息 / 元数据 / 压缩快照)。
重启后可用 `--resume <id>` 恢复,`buildContext` 从 entries 重建 messages 数组。

## Compaction

上下文超过阈值时,调用 LLM 生成会话摘要,替换早期消息。当前策略保留最近 N 条,前面全压缩。

## 技术栈

- **TypeScript** (原生 ESM, `tsx` 运行)
- **Typebox** (工具参数 schema + 运行时校验)
- **Node 20+ fetch** (原生 HTTP + AbortSignal)
- **SSE async generator** (自研 `sse.ts`, ~60 行)

## 设计原则(累积于 day-1 ~ day-8)

1. **抽象要用调用方的语言,不用实现方的语言** —— StreamEvent 里叫 `tool_use_start`,而不是 Anthropic 的 `content_block_start`
2. **每层只翻译一次形状** —— 字节 → SseEvent → 原生对象 → StreamEvent
3. **状态归属于最先需要它的那一层** —— provider 维护 `index → block` 表,agent.ts 不管
4. **协议边界不等于传输边界** —— SSE 事件在空行处结束,不在 chunk 处结束
5. **协议提供 ≠ 消费者必须处理** —— provider 吐 tool_use_delta,agent.ts 静默忽略是合法的
6. **每次改动只承担一个变化** —— day-8 加 streaming 时不重构 complete
7. **错误由制造它的那一层负责报告** —— JSON.parse 失败在协议层 catch,不在 SSE 层

## 学习路径

如果你想按这个项目学习 agent 框架,建议:

1. 从 [`learn_note/day-1.md`](./learn_note/day-1.md) 开始按序阅读
2. Day-8 的抽象点(分层翻译 / 状态机 / discriminated union)是全项目最难也最有价值的一节
3. 每天读完对应源码可以跑一遍 `npx tsx agent.ts` 感受行为
