const express = require('express');
const cors = require('cors');
const fs = require('fs/promises'); 
const path = require('path'); 
const { exec } = require('child_process'); 
const util = require('util');
const execPromise = util.promisify(exec);
require('dotenv').config();

const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai'); 

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); 

// 🔑 CLOUD API KEYS
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null; 
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const HF_KEY = process.env.HF_API_KEY;

const WORKSPACE_DIR = './mantu_workspace';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 🧠 MODELS CONFIG
const MASTER_MODEL = 'llama-3.3-70b-versatile'; 
const GEMINI_WORKER = 'gemini-1.5-flash'; 
const GROQ_WORKER = 'llama-3.3-70b-versatile'; 

const extractJson = (text) => {
    try {
        let cleanText = text.replace(/```(json)?/gi, '').replace(/```/gi, '').trim();
        const match = cleanText.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : JSON.parse(cleanText);
    } catch (e) {
        return null;
    }
};

const cleanRawCode = (text) => {
    return text.replace(/```[a-zA-Z]*\n/gi, '').replace(/```/gi, '').trim();
};

const initWorkspace = async () => {
    try { await fs.mkdir(WORKSPACE_DIR, { recursive: true }); } catch (e) {}
};
initWorkspace();

// 🔥 THE 5-TIER ENGINE WITH 30-SECOND AWS TIMEOUT 🔥
async function safeGenerate(promptText, isJson = true, sendEvent = null) {
    
    // 🥇 TIER 1: YOUR CUSTOM AWS API (30 Seconds Max Limit)
    try {
        const awsApiUrl = process.env.AWS_API_URL || "http://54.224.241.169:8000/chat";
        const finalPrompt = promptText + (isJson ? " MUST RETURN JSON FORMAT ONLY." : " MUST RETURN RAW CODE ONLY. NO MARKDOWN.");
        const finalUrl = `${awsApiUrl}?prompt=${encodeURIComponent(finalPrompt)}`;

        if(sendEvent) sendEvent('log', { agent: "AWS Engine", status: "Waiting", details: "Trying AWS Local Llama-3 (Max 30s limit)..." });

        // ⏱️ 30 Second ka Timer (AbortController)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30000 ms = 30 seconds

        const awsRes = await fetch(finalUrl, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "x-api-key": process.env.AWS_API_PASSWORD || "mantu_godmode_secure_999" 
            },
            signal: controller.signal // Isse 30 sec baad request cut ho jayegi
        });

        clearTimeout(timeoutId); // Agar 30 sec se pehle aa gaya toh timer band kardo

        if (!awsRes.ok) throw new Error(`HTTP ${awsRes.status}`);
        const awsData = await awsRes.json();
        
        if(awsData.error) throw new Error(awsData.error);
        return { text: awsData.response, engine: "AWS Custom Llama-3" };
        
    } catch (awsErr) {
        // Agar Timer fail hua (Timeout) ya server down hua, toh turant backup par jao
        const isTimeout = awsErr.name === 'AbortError' || awsErr.message.includes('timeout');
        const errMsg = isTimeout ? "30s Timeout Exceeded" : awsErr.message.substring(0, 30);
        
        if(sendEvent) sendEvent('log', { agent: "System Router", status: "Switching", details: `AWS Failed (${errMsg}). Moving to Gemini...` });
        
        // 🥈 TIER 2: GEMINI
        try {
            if (!genAI) throw new Error("Gemini Key Missing");
            const geminiModel = genAI.getGenerativeModel({ 
                model: GEMINI_WORKER,
                generationConfig: isJson ? { responseMimeType: "application/json" } : {}
            });
            const res = await geminiModel.generateContent(promptText);
            return { text: res.response.text(), engine: "Gemini" };
        } catch (geminiErr) {
            if(sendEvent) sendEvent('log', { agent: "System Router", status: "Switching", details: `Gemini Down. Moving to Groq...` });
            
            // 🥉 TIER 3: GROQ
            try {
                await sleep(1000); 
                const groqRes = await groq.chat.completions.create({ 
                    messages: [
                        { role: 'system', content: isJson ? "Output valid JSON only." : "Output ONLY raw code. No markdown." },
                        { role: 'user', content: promptText }
                    ], 
                    model: GROQ_WORKER, 
                    temperature: 0.2, 
                    response_format: isJson ? { type: 'json_object' } : null
                });
                return { text: groqRes.choices[0].message.content, engine: "Groq" };
            } catch (groqErr) {
                if(sendEvent) sendEvent('log', { agent: "System Router", status: "Switching", details: `Groq Down. Engaging OpenRouter/HF...` });
                
                // 🏅 TIER 4: OPENROUTER
                try {
                    if (!OPENROUTER_KEY) throw new Error("OpenRouter Key Missing");
                    await sleep(1000);
                    const openRouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                        method: "POST",
                        headers: { 
                            "Authorization": `Bearer ${OPENROUTER_KEY}`, 
                            "Content-Type": "application/json",
                            "HTTP-Referer": "https://mantu-ai.com",
                            "X-Title": "Mantu AI"
                        },
                        body: JSON.stringify({
                            model: "mistralai/mistral-7b-instruct:free", 
                            messages: [{ role: "user", content: promptText + (isJson ? " MUST RETURN JSON FORMAT ONLY." : " MUST RETURN RAW CODE ONLY. NO MARKDOWN.") }]
                        })
                    });
                    const orText = await openRouterRes.text();
                    if (!openRouterRes.ok) throw new Error(`OR Error: ${orText}`);
                    const openRouterData = JSON.parse(orText);
                    return { text: openRouterData.choices[0].message.content, engine: "OpenRouter" };
                } catch (openRouterErr) {
                    
                    // 🎖️ TIER 5: HUGGING FACE
                    try {
                        if (!HF_KEY) throw new Error("HF Key Missing");
                        await sleep(1000);
                        const hfRes = await fetch("https://api-inference.huggingface.co/models/HuggingFaceH4/zephyr-7b-beta", { 
                            method: "POST",
                            headers: { "Authorization": `Bearer ${HF_KEY}`, "Content-Type": "application/json" },
                            body: JSON.stringify({ inputs: `<|user|>\n${promptText}</s>\n<|assistant|>` }) 
                        });
                        const hfText = await hfRes.text();
                        if (!hfRes.ok) throw new Error(`HF Error: ${hfText}`);
                        const hfData = JSON.parse(hfText);
                        return { text: hfData[0].generated_text.split('<|assistant|>')[1] || hfData[0].generated_text, engine: "HuggingFace" };
                    } catch (hfErr) {
                        throw new Error("CRITICAL_QUOTA_EMPTY"); 
                    }
                }
            }
        }
    }
}

app.get('/api/env', (req, res) => {
    res.json({ success: true, variables: { MANTU_AI_STATUS: "LIVE STREAMING + 30s AWS TIMEOUT ACTIVE" } });
});

// 🔥 LIVE STREAMING ENDPOINT (1-BY-1 FILES) 🔥
app.post('/api/build', async (req, res) => {
    const { prompt } = req.body; 
    console.log(`\n[🚀 Live Stream Swarm Initiated]`);

    // Headers set for Server-Sent Events (SSE)
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    const sendEvent = (type, data) => {
        res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    try {
        let finalPrompt = prompt + "\n[CRITICAL: Use modern standards.]";

        sendEvent('log', { agent: "Omni-Master", status: "Planning Blueprint", details: "Designing architecture..." });
        
        const masterPrompt = `You are the Omni-Language Master. Request: "${finalPrompt}"
        Determine Tech Stack, EXACT file paths with nested folders, and NPM packages.
        Return ONLY JSON: { "tech_stack": "...", "files_needed": ["src/App.jsx"], "dependencies": ["axios"] }`;

        let masterData;
        try {
            const masterRes = await groq.chat.completions.create({ messages: [{ role: 'system', content: masterPrompt }], model: MASTER_MODEL, temperature: 0.1, response_format: { type: 'json_object' } });
            masterData = JSON.parse(masterRes.choices[0].message.content);
        } catch (e) {
            const backupMaster = await safeGenerate(masterPrompt, true, sendEvent);
            masterData = extractJson(backupMaster.text);
        }

        const techStack = masterData?.tech_stack || "React";
        const filesToGenerate = masterData?.files_needed || ["src/App.jsx"];
        
        sendEvent('log', { agent: "System Architect", status: "Stack Locked", details: `Generating ${filesToGenerate.length} files.` });

        // Loop files 1-by-1
        for (const filename of filesToGenerate) {
            try {
                sendEvent('log', { agent: `${techStack} Dev`, status: "Deep Coding", details: `Writing logic for ${filename}...` });
                
                const workerPrompt = `You are an Elite Developer. Project Context: "${finalPrompt}".
                🚨 CRITICAL: YOU ARE ONLY WRITING CODE FOR ${filename}. Do not write other files.
                Return ONLY the raw functional code. DO NOT wrap it in JSON. DO NOT use markdown blocks like \`\`\`javascript. Just the pure code text.`;
                
                // Safe Generate with Event Sender
                const generatedData = await safeGenerate(workerPrompt, false, sendEvent); 
                let currentCode = cleanRawCode(generatedData.text);
                
                currentCode = `/* \n * 🚀 Code Generated by Mantu AI \n * 🧠 Active Engine: ${generatedData.engine}\n */\n\n` + currentCode;
                
                const absoluteFilePath = path.join(WORKSPACE_DIR, filename);
                await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true });
                await fs.writeFile(absoluteFilePath, currentCode);

                // 🔥 SEND FILE IMMEDIATELY TO FRONTEND 🔥
                sendEvent('file', { filename: filename, code: currentCode });
                sendEvent('log', { agent: `${generatedData.engine} Worker`, status: "File Generated", details: `${filename} successfully written.` });

            } catch (fileError) {
                if (fileError.message === "CRITICAL_QUOTA_EMPTY") {
                    sendEvent('error', { error: "⚠️ ALERT: Saare 5 Engines (AWS + 4 Cloud APIs) down hain! AWS server chalu karein." });
                    break;
                }
                sendEvent('log', { agent: "System Crash", status: "API Exhausted", details: `Failed on ${filename}.` });
            }
        }

        sendEvent('log', { agent: "Deployment Manager", status: "Success", details: `Project built perfectly!` });
        sendEvent('done', { success: true });
        res.end(); // Close the stream properly

    } catch (error) {
        sendEvent('error', { error: `Swarm Error: ${error.message}` });
        res.end();
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running...`));
