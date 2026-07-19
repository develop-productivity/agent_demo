import { spawn } from "node:child_process";

  // 复制自 agent.js（保持一致）
function appendStatus(text, status) {
    return text ? `${text}\n\n${status}` : status;
}

function killProcessTree(pid) {
    if (process.platform === "win32") {
        // windows
        try {spawn("taskkill", ["/T", "/F", "/PID", pid.toString()], { stdio: "ignore", detached: true});}
        catch (e) {}
        return 
    }
    // unix
    try {
        process.kill(-pid, "SIGKILL")
    } catch {
        // 兜底
        try {process.kill(pid, "SIGKILL")} catch {}
    }
}

function runBash(command, { timeout=10, maxOutput = 100_000, signal } = {}) {
    return new Promise((resolveP, rejectP) => {
        if (signal?.aborted) {
            return rejectP(new Error("Command aborted"));
        }

        const proc = spawn("bash", ["-c", command], {
            detached: process.platform !== "win32",
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "", stderr = "";
        let truncated = false;
        let timedOut = false;
        let timeoutHandle;

        const killOnce = () => { try { killProcessTree(proc.pid); } catch {} };
        const onAbort = () => killOnce();
        // 内部超时通道（对齐 pi bash.ts L94-99）
        if (timeout !== undefined && timeout > 0) {
            timeoutHandle = setTimeout(() => {
                timedOut = true;
                killOnce();
            }, timeout * 1000);
        }
        // finally 三件套（对齐 pi bash.ts L117-123）
        const cleanup = () => {
            if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = undefined; }
            if (signal) signal.removeEventListener("abort", onAbort);
        };
        
        proc.stdout.on("data", (data) => {
            if (stdout.length + data.length > maxOutput) {
                if (!truncated) killOnce();
                truncated = true;
                return;
            }
            stdout += data;
        });
        proc.stderr.on("data", (data) => {
            if (stderr.length + data.length > maxOutput) {
                if (!truncated) killOnce();
                truncated = true;
                return;
            }
            stderr += data;
        });
        // 外部 abort 通道（对齐 pi bash.ts L102-108）
        if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
        }

        proc.on("error", (err) => {
            cleanup();
            rejectP(new Error(`spawn error: ${err.message}`));
        });

        proc.on("close", (exitCode) => {
            cleanup();
            let combined = stdout;
            if (stderr) combined += `${combined ? "\n" : ""}[stderr]\n${stderr}`;
            if (truncated) combined += "\n\n[...truncated]";

            // 错误分派：优先级 abort > timeout > 非零退出（对齐 pi bash.ts L388-401）
            if (signal?.aborted) {
                return rejectP(new Error(appendStatus(combined, "Command aborted")));
            }
            if (timedOut) {
                return rejectP(new Error(appendStatus(combined, `Command timed out after ${timeout} seconds`)));
            }
            if (exitCode !== 0 && exitCode !== null) {
                return rejectP(new Error(appendStatus(combined, `Command exited with code ${exitCode}`)));
            }
            resolveP(combined || "(no output)");
        });
    });
}

// // ---------- 测试用例 ----------
// async function run(name, fn) {
//     process.stdout.write(`[${name}] `);
//     try {
//         const out = await fn();
//         console.log(`OK\n    → ${JSON.stringify(out.slice(0, 200))}`);
//     } catch (e) {
//         console.log(`THROW\n    → ${JSON.stringify(e.message.slice(0, 200))}`);
//     }
// }
// 
// await run("1. 正常输出", () => runBash("echo hello"));
// 
// await run("2. 非零退出带 stderr", () => runBash("ls /notexist"));
// // 期望：throw，message 里既有 ls 的 stderr，也有 "exited with code"
// 
// await run("3. 长输出触发截断", () => runBash("seq 1 100000"));
// // 期望：resolve，末尾有 [...truncated]
// 
// await run("4. 超时", () => runBash("sleep 10", { timeout: 1 }));
// // 期望：throw "Command timed out after 1 seconds"
// 
// await run("5. 外部 abort", async () => {
//     const ac = new AbortController();
//     setTimeout(() => ac.abort(), 300);
//     return runBash("sleep 10", { signal: ac.signal });
// });
// // 期望：throw "Command aborted"
// 
// await run("6. 失败时带 stdout 内容", () => runBash("echo before-fail; exit 3"));
// // 期望：throw，message 前面能看到 "before-fail"，后面有 "exited with code 3"
// 
// await run("7. 孤儿进程", async () => {
//       // 起一个用独特字符串标识的 sleep，方便查
//       await runBash("(sleep 8888 &); echo spawned", { timeout: 1 }).catch(() => {});
//       await new Promise(r => setTimeout(r, 300));   // 给 OS 一点时间清理
//       const after = await runBash("pgrep -f 'sleep 8888' | wc -l").catch(e => e.message);
//       return `orphan count = ${after.trim()}`;
//   });