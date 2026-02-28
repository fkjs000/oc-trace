#!/usr/bin/env node

const fs = require('fs');
const readline = require('readline');
const path = require('path');

/**
 * OpenClaw Performance Tracing Tool (oc-trace)
 * Versatile version for NPM package distribution.
 */

// --- Parameter Parsing ---
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : null;
const watchMode = args.includes('--watch');
const sinceIdx = args.indexOf('--since');
const sinceStr = sinceIdx !== -1 ? args[sinceIdx + 1] : null;

// Allow custom log directory
const logDirIdx = args.indexOf('--log-dir');
const DEFAULT_LOG_DIR = process.env.OPENCLAW_LOG_DIR || '/tmp/openclaw';
const LOG_DIR = logDirIdx !== -1 ? args[logDirIdx + 1] : DEFAULT_LOG_DIR;

let sinceTime = null;
if (sinceStr) {
    const match = sinceStr.match(/^(\d+)([mh])$/);
    if (match) {
        const val = parseInt(match[1]);
        const unit = match[2];
        sinceTime = Date.now() - (val * (unit === 'm' ? 60000 : 3600000));
    }
}

function getLogPath(date = new Date()) {
    return path.join(LOG_DIR, 'openclaw-' + date.toISOString().split('T')[0] + '.log');
}

const activeLanes = new Map();
const completedSessions = [];

function parseLogLine(line) {
    if (!line || !line.trim()) return;
    try {
        const entry = JSON.parse(line);
        const msg = entry[1];
        if (!msg || typeof msg !== 'string') return;
        const meta = entry._meta || {};
        const date = new Date(meta.date || entry.time);
        
        if (sinceTime && date.getTime() < sinceTime) return;

        // T1/T2: Ingress & Queuing
        if (msg.includes('lane enqueue: lane=')) {
            const sidMatch = msg.match(/lane=([^ ]+)/);
            if (sidMatch) {
                const sid = sidMatch[1];
                if (watchMode) console.error(`[DEBUG] 📥 New message arriving in lane: ${sid.split(':').pop()}`);
                activeLanes.set(sid, { 
                    t_received: date, 
                    id: sid, 
                    stage: 'queued',
                    memories: 0,
                    runId: null
                });
            }
        }

        // T3: Dequeue
        if (msg.includes('lane dequeue: lane=')) {
            const sidMatch = msg.match(/lane=([^ ]+)/);
            const waitMatch = msg.match(/waitMs=(\d+)/);
            if (sidMatch && activeLanes.has(sidMatch[1])) {
                const s = activeLanes.get(sidMatch[1]);
                s.t_dequeue = date;
                s.waitMs = waitMatch ? parseInt(waitMatch[1]) : 0;
                s.stage = 'dequeued';
            }
        }

        // Context Prep: Memory
        if (msg.includes('memory-lancedb-pro: injecting')) {
            const memMatch = msg.match(/injecting (\d+) memories/);
            for (let s of activeLanes.values()) {
                if (s.stage === 'dequeued') {
                    s.t_memory_inject = date;
                    s.memories = memMatch ? parseInt(memMatch[1]) : 0;
                    s.stage = 'memory_injected';
                }
            }
        }

        // T4: Agent Start
        if (msg.includes('embedded run start:')) {
            const ridMatch = msg.match(/runId=([^ ]+)/);
            const modelMatch = msg.match(/model=([^ ]+)/);
            if (ridMatch) {
                const rid = ridMatch[1];
                for (let s of activeLanes.values()) {
                    if ((s.stage === 'dequeued' || s.stage === 'memory_injected') && !s.runId) {
                        s.runId = rid;
                        s.model = modelMatch ? modelMatch[1] : 'unknown';
                        s.t_inference_start = date;
                        s.stage = 'inference';
                        if (watchMode) console.error(`[DEBUG] 🤖 Agent started (Run: ${rid.slice(0,8)}) using ${s.model}`);
                        break;
                    }
                }
            }
        }

        // T5: Inference End
        if (msg.includes('embedded run prompt end:') || msg.includes('embedded run done:')) {
            const ridMatch = msg.match(/runId=([^ ]+)/);
            const durMatch = msg.match(/durationMs=(\d+)/);
            if (ridMatch) {
                const rid = ridMatch[1];
                for (let s of activeLanes.values()) {
                    if (s.runId === rid) {
                        s.t_inference_end = date;
                        s.inferenceMs = durMatch ? parseInt(durMatch[1]) : 0;
                        s.stage = 'inference_done';
                        if (watchMode) console.error(`[DEBUG] ✅ Inference finished in ${(s.inferenceMs/1000).toFixed(2)}s`);
                        break;
                    }
                }
            }
        }

        // T6: Delivery (Done)
        if (msg.includes('sendMessage ok')) {
            for (let [laneId, s] of activeLanes) {
                if (s.stage === 'inference_done' && !s.t_done) {
                    s.t_done = date;
                    s.stage = 'completed';
                    if (watchMode) {
                        printSession(s);
                    } else {
                        completedSessions.push({...s});
                    }
                    activeLanes.delete(laneId); 
                    break;
                }
            }
        }
    } catch (e) {}
}

function printSession(s) {
    if (!s.t_done || !s.runId) return;
    const totalMs = s.t_done - s.t_received;
    const hookMs = (s.t_memory_inject && s.t_dequeue) ? (s.t_memory_inject - s.t_dequeue) : 0;
    const memoryMs = (s.t_inference_start && s.t_memory_inject) ? (s.t_inference_start - s.t_memory_inject) : 0;
    
    process.stdout.write(`\n[${s.t_received.toLocaleTimeString()}] Run: ${s.runId.slice(0,8)}...`);
    process.stdout.write(`\nModel:    ${s.model}`);
    process.stdout.write(`\n-------------------------------------------`);
    process.stdout.write(`\n⏱️  隊列等待: ${(s.waitMs || 0).toString().padStart(7)} ms`);
    process.stdout.write(`\n🧪 前置處理: ${hookMs.toString().padStart(7)} ms (Hooks)`);
    process.stdout.write(`\n🔍 記憶檢索: ${memoryMs.toString().padStart(7)} ms (${s.memories || 0} 筆記憶)`);
    process.stdout.write(`\n🤖 模型推理: ${(s.inferenceMs / 1000).toFixed(2).padStart(7)} s`);
    process.stdout.write(`\n🚀 傳送回傳: ${((s.t_done - s.t_inference_end) / 1000).toFixed(2).padStart(7)} s`);
    process.stdout.write(`\n-------------------------------------------`);
    process.stdout.write(`\n✨ 總計耗時: ${(totalMs / 1000).toFixed(2).padStart(7)} s\n\n`);
}

async function run() {
    process.stdout.write(`\n🦞 OpenClaw 效能巡檢工具 (oc-trace)`);
    
    let logPath = getLogPath();
    if (!fs.existsSync(logPath)) {
        console.error(`\nError: Log file ${logPath} not found.`);
        console.error(`Check your log directory: ${LOG_DIR}`);
        process.exit(1);
    }

    if (watchMode) {
        process.stdout.write(`\n模式: 實時監控 (WATCH)... 正在監聽: ${logPath}\n`);
    } else if (sinceStr) {
        process.stdout.write(`\n模式: 時間過濾 (最近 ${sinceStr})\n`);
    } else {
        process.stdout.write(`\n模式: ${limit ? `歷史快照 (最近 ${limit} 筆)` : '全量掃描 (今日)'}\n`);
    }

    // Initial Scan - Stream based for efficiency
    if (!watchMode || (watchMode && sinceTime)) {
        const fileStream = fs.createReadStream(logPath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
        for await (const line of rl) {
            parseLogLine(line);
        }
        if (!watchMode) {
            const toShow = limit ? completedSessions.slice(-limit) : completedSessions;
            toShow.forEach(printSession);
            return;
        }
    }

    if (watchMode) {
        let currentSize = fs.statSync(logPath).size;
        let remainder = "";
        let currentDateStr = new Date().toISOString().split('T')[0];

        setInterval(() => {
            try {
                // Check for log rotation (date change)
                const now = new Date();
                const nowStr = now.toISOString().split('T')[0];
                if (nowStr !== currentDateStr) {
                    const newPath = getLogPath(now);
                    if (fs.existsSync(newPath)) {
                        console.error(`\n[SYSTEM] Log rotated to ${newPath}`);
                        logPath = newPath;
                        currentDateStr = nowStr;
                        currentSize = 0;
                        remainder = "";
                    }
                }

                const stats = fs.statSync(logPath);
                if (stats.size > currentSize) {
                    const fd = fs.openSync(logPath, 'r');
                    const buffer = Buffer.alloc(stats.size - currentSize);
                    fs.readSync(fd, buffer, 0, buffer.length, currentSize);
                    fs.closeSync(fd);
                    
                    const content = remainder + buffer.toString();
                    const lines = content.split('\n');
                    
                    remainder = lines.pop(); 
                    lines.forEach(line => parseLogLine(line));
                    
                    currentSize = stats.size;
                }
            } catch (e) {
                console.error(`\n[DEBUG] Error reading update: ${e.message}`);
            }
        }, 500);
    }
}

run().catch(console.error);
