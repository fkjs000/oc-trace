#!/usr/bin/env node

const fs = require('fs');
const readline = require('readline');
const path = require('path');

/**
 * OpenClaw Performance Tracing Tool (oc-trace)
 * Version: v20260228-FINAL (Full Support for LINE & Telegram)
 */

const VERSION = "v20260228-FINAL";
const args = process.argv.slice(2);
const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 10;
const watchMode = args.includes('--watch');
const DEFAULT_LOG_DIR = process.env.OPENCLAW_LOG_DIR || '/tmp/openclaw';

function getLogPath(date = new Date()) {
    return path.join(DEFAULT_LOG_DIR, 'openclaw-' + date.toISOString().split('T')[0] + '.log');
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
        
        // --- T1/T2: 入隊 (Enqueue) ---
        if (msg.includes('lane enqueue: lane=')) {
            const sid = msg.match(/lane=([^ ]+)/)?.[1];
            if (sid) {
                if (watchMode) console.error(`[DEBUG] 📥 訊息進入管道: ${sid}`);
                activeLanes.set(sid, { 
                    t_received: date, 
                    id: sid, 
                    stage: 'queued',
                    memories: 0,
                    runId: null
                });
            }
        }

        // --- T3: 出隊 (Dequeue) ---
        if (msg.includes('lane dequeue: lane=')) {
            const sid = msg.match(/lane=([^ ]+)/)?.[1];
            const waitMs = msg.match(/waitMs=(\d+)/)?.[1];
            if (sid && activeLanes.has(sid)) {
                const s = activeLanes.get(sid);
                s.t_dequeue = date;
                s.waitMs = waitMs ? parseInt(waitMs) : 0;
                s.stage = 'dequeued';
            }
        }

        // --- 記憶檢索 (Memory) ---
        if (msg.includes('memory-lancedb-pro: injecting')) {
            const count = msg.match(/injecting (\d+) memories/)?.[1];
            for (let s of activeLanes.values()) {
                if (s.stage === 'dequeued' || s.stage === 'queued') {
                    s.t_memory_inject = date;
                    s.memories = count ? parseInt(count) : 0;
                    s.stage = 'memory_injected';
                }
            }
        }

        // --- T4: 推理開始 (Inference Start) ---
        if (msg.includes('embedded run start:')) {
            const rid = msg.match(/runId=([^ ]+)/)?.[1];
            const model = msg.match(/model=([^ ]+)/)?.[1];
            if (rid) {
                let found = false;
                for (let s of activeLanes.values()) {
                    if (!s.runId && (s.stage === 'dequeued' || s.stage === 'memory_injected' || s.stage === 'queued' || s.stage === 'inference')) {
                        s.runId = rid;
                        s.model = model || 'unknown';
                        s.t_inference_start = date;
                        s.stage = 'inference';
                        found = true;
                    }
                }
                if (watchMode && found) console.error(`[DEBUG] 🤖 Agent 啟動 (Run: ${rid.slice(0,8)}) 模型: ${model}`);
            }
        }

        // --- T5: 推理/任務完成 (Inference End / Task Done) ---
        if (msg.includes('embedded run done:') || msg.includes('lane task done:')) {
            const rid = msg.match(/runId=([^ ]+)/)?.[1];
            const sid = msg.match(/lane=([^ ]+)/)?.[1];
            const dur = msg.match(/durationMs=(\d+)/)?.[1];

            if (rid) {
                for (let s of activeLanes.values()) {
                    if (s.runId === rid) {
                        s.inferenceMs = dur ? parseInt(dur) : (s.inferenceMs || 0);
                        s.t_inference_end = date;
                        s.stage = 'inference_done';
                        if (watchMode && dur) console.error(`[DEBUG] ✅ 推理結束: ${(s.inferenceMs/1000).toFixed(2)}s`);
                    }
                }
            }

            if (sid && activeLanes.has(sid)) {
                const s = activeLanes.get(sid);
                if (dur) s.inferenceMs = parseInt(dur);
                s.t_inference_end = date;
                s.t_done = date;
                s.stage = 'completed';
                
                if (watchMode) {
                    console.error(`[DEBUG] ✨ 管道 ${sid.split(':').pop()} 處理完畢，正在產生報表...`);
                    printSession(s);
                } else {
                    completedSessions.push({...s});
                }
                activeLanes.delete(sid);
            }
        }

        // --- T6: 最終配送 (Telegram 專用收尾) ---
        if (msg.includes('sendMessage ok')) {
            for (let [laneId, s] of activeLanes) {
                if (s.stage === 'inference_done' || s.stage === 'inference') {
                    s.t_done = date;
                    s.stage = 'completed';
                    if (watchMode) printSession(s);
                    else completedSessions.push({...s});
                    activeLanes.delete(laneId);
                }
            }
        }
    } catch (e) {
        if (watchMode) console.error(`[ERROR] 解析日誌出錯: ${e.message}`);
    }
}

function printSession(s) {
    if (!s.t_received) return;
    
    const t_end = s.t_done || new Date();
    const totalMs = t_end - s.t_received;
    const hookMs = (s.t_memory_inject && s.t_dequeue) ? (s.t_memory_inject - s.t_dequeue) : 0;
    const memoryMs = (s.t_inference_start && s.t_memory_inject) ? (s.t_inference_start - s.t_memory_inject) : 0;
    
    const idDisplay = s.runId ? `Run: ${s.runId.slice(0,8)}...` : `Lane: ${s.id.split(':').pop()}`;

    console.log(`\n===========================================`);
    console.log(`[${s.t_received.toLocaleTimeString()}] ${idDisplay} (${VERSION})`);
    console.log(`模型:    ${s.model || 'unknown'}`);
    console.log(`-------------------------------------------`);
    console.log(`⏱️  隊列等待: ${(s.waitMs || 0).toString().padStart(7)} ms`);
    console.log(`🧪 前置處理: ${hookMs.toString().padStart(7)} ms (Hooks)`);
    console.log(`🔍 記憶檢索: ${memoryMs.toString().padStart(7)} ms (${s.memories || 0} 筆記憶)`);
    console.log(`🤖 模型推理: ${((s.inferenceMs || 0) / 1000).toFixed(2).padStart(7)} s`);
    console.log(`🚀 總計耗時: ${(totalMs / 1000).toFixed(2).padStart(7)} s`);
    console.log(`===========================================\n`);
}

async function run() {
    console.log(`\n🦞 OpenClaw 效能追蹤工具 (oc-trace) ${VERSION}`);
    let logPath = getLogPath();
    
    if (!fs.existsSync(logPath)) {
        console.error(`Error: 找不到日誌檔 ${logPath}`);
        process.exit(1);
    }

    if (watchMode) {
        console.log(`模式: 實時監控 (WATCH)... 檔案: ${logPath}\n`);
        
        let currentSize = fs.statSync(logPath).size;
        let remainder = "";

        setInterval(() => {
            try {
                const stats = fs.statSync(logPath);
                if (stats.size > currentSize) {
                    const fd = fs.openSync(logPath, 'r');
                    const buffer = Buffer.alloc(stats.size - currentSize);
                    fs.readSync(fd, buffer, 0, buffer.length, currentSize);
                    fs.closeSync(fd);
                    const lines = (remainder + buffer.toString()).split('\n');
                    remainder = lines.pop();
                    lines.forEach(parseLogLine);
                    currentSize = stats.size;
                }
            } catch (e) {}
        }, 500);
    } else {
        const rl = readline.createInterface({ input: fs.createReadStream(logPath), crlfDelay: Infinity });
        for await (const line of rl) parseLogLine(line);
        completedSessions.slice(-limit).forEach(printSession);
    }
}

run().catch(console.error);
