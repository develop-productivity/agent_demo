import { resolve, relative } from "node:path";
import { spawn } from "node:child_process";

const SANDBOX_ROOT = resolve(process.cwd());

export function withLineNumbers(text) {
    const lines = text.split("\n");
    const width = String(lines.length).length;
    return lines
        .map((line, i) => `${String(i + 1).padStart(width, " ")}\t${line}`)
        .join("\n");
}

export function killProcessTree(pid) {
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

// 对齐 pi bash.ts L373 的 appendStatus
export function appendStatus(text, status) {
    return text ? `${text}\n\n${status}` : status;
}

export function confirm(rl, prompt) {
    return new Promise((resolve) => {
        rl.question(`${prompt} [y/N]:`, (ans) => {
            resolve(ans.trim().toLowerCase() === "y" || ans.trim().toLowerCase() === "yes");
        });
    });
}

export function runBash(command, { timeout, maxOutput = 100_000, signal } = {}) {
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


export function assertInSandbox(userPath) {
    const abs = resolve(SANDBOX_ROOT, userPath);
    const rel = relative(SANDBOX_ROOT, abs);
    if (rel.startsWith("..") || rel.startsWith("/")) {
        throw new Error(`path: '${userPath}' escape sandbox '${SANDBOX_ROOT}'`);
    }
    return abs;
}

