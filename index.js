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
app.use(express.json({ limit: '50mb' })); // Vision Image limit

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null; 

const WORKSPACE_DIR = './mantu_workspace';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const MASTER_MODEL = 'llama-3.3-70b-versatile'; 
const GEMINI_WORKER = 'gemini-1.5-flash'; 

// ==========================================
// 🛠️ UTILITY FUNCTIONS
// ==========================================
const extractJson = (text) => {
    try {
        let cleanText = text.replace(/```(json)?/gi, '').replace(/```/gi, '').trim();
        const match = cleanText.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : JSON.parse(cleanText);
    } catch (e) { return null; }
};

// 🔥 AI Ki Faltu Baatein Hatane Wala Filter 🔥
const cleanRawCode = (text) => {
    if (!text) return "";
    
    // 1. Agar AI ne markdown backticks (```) use kiye hain, toh uske andar ka code nikalo
    const blockMatch = text.match(/```[\w]*\n([\s\S]*?)```/);
    if (blockMatch && blockMatch[1]) return blockMatch[1].trim();
    
    const inlineMatch = text.match(/```([\s\S]*?)```/);
    if (inlineMatch && inlineMatch[1]) return inlineMatch[1].trim();
    
    // 2. Fallback: "Here is the code" jaisi lines delete karo
    let cleaned = text.replace(/^(Here is|This is|Sure|Below is|The code for).*?:?\n/gi, '');
    cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, ''); // **filename.js** markers remove karo
    cleaned = cleaned.replace(/```[a-zA-Z]*\n?/gi, '').replace(/```/gi, '');
    return cleaned.trim();
};

// ==========================================
// 🧠 THE TRI-ENGINE ROUTER (AWS -> Groq -> Gemini)
// ==========================================
async function safeGenerate(promptText, isJson = true, sendEvent = null) {
    try {
        // AWS GPU TIER
        const awsApiUrl = process.env.AWS_API_URL || "[http://3.209.1.117:8000/chat](http://3.209.1.117:8000/chat)"; 
        const finalUrl = `${awsApiUrl}?prompt=${encodeURIComponent(promptText)}`;
        
        if(sendEvent) sendEvent('log', { agent: "AWS GPU Engine", status: "Computing", details: "Llama-3 processing on Nvidia A10G..." });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 Min Timeout

        const awsRes = await fetch(finalUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": process.env.AWS_API_PASSWORD || "mantu_godmode_secure_999" },
            signal: controller.signal 
        });
        clearTimeout(timeoutId); 

        if (!awsRes.ok) throw new Error("AWS Server Unreachable");
        const awsData = await awsRes.json();
        
        if(awsData.error) throw new Error(awsData.error);
        return { text: awsData.response, engine: "AWS Llama-3 GPU" };
        
    } catch (awsErr) {
        if(sendEvent) sendEvent('log', { agent: "System Router", status: "Switching", details: `AWS Busy. Switching to Groq...` });
        
        // GROQ TIER
        try {
            await sleep(1000); 
            const groqRes = await groq.chat.completions.create({ 
                messages: [ { role: 'system', content: isJson ? "Output valid JSON only." : "Output ONLY raw code." }, { role: 'user', content: promptText } ], 
                model: MASTER_MODEL, temperature: 0.2, response_format: isJson ? { type: 'json_object' } : null
            });
            return { text: groqRes.choices[0].message.content, engine: "Groq" };
        } catch (groqErr) {
            
            // GEMINI TIER
            try {
                if (!genAI) throw new Error("Gemini Key Missing");
                const geminiModel = genAI.getGenerativeModel({ model: GEMINI_WORKER, generationConfig: isJson ? { responseMimeType: "application/json" } : {} });
                const res = await geminiModel.generateContent(promptText);
                return { text: res.response.text(), engine: "Gemini" };
            } catch (geminiErr) { throw new Error("ALL ENGINES FAILED"); }
        }
    }
}

// 🌐 Web Scraper
async function fetchUrlContent(url) {
    try {
        const response = await fetch(url);
        const text = await response.text();
        return text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '').substring(0, 10000); 
    } catch (e) { return "Failed to scrape URL."; }
}

// ==========================================
// 🚀 MAIN BUILD API (Streaming)
// ==========================================
app.post('/api/build', async (req, res) => {
    let { prompt, image, contextFiles, isAutoFix } = req.body; 
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const sendEvent = (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

    try {
        // 🩺 Self-Healing Check
        if (isAutoFix) {
            sendEvent('log', { agent: "Self-Healing Agent", status: "Diagnosing Error", details: "Analyzing browser error..." });
            prompt = `[AUTO-FIX REQUEST] Fix the code to resolve this error: "${prompt}". Return ONLY the strictly corrected file code.`;
        }

        // 🌐 URL Check
        const urlMatch = prompt.match(/https?:\/\/[^\s]+/);
        if (urlMatch) {
            sendEvent('log', { agent: "Web Scraper", status: "Fetching URL", details: `Scraping data from ${urlMatch[0]}...` });
            const urlData = await fetchUrlContent(urlMatch[0]);
            prompt += `\n\n[REFERENCE WEBSITE SOURCE CODE]:\n${urlData}`;
        }

        sendEvent('log', { agent: "Research Agent", status: "Fetching Standards", details: "Loading latest tech standards..." });
        let finalPrompt = prompt + "\n[CRITICAL RESEARCH: Use latest modern syntax.]";

        let masterData;
        sendEvent('log', { agent: "Omni-Master", status: "Planning Blueprint", details: "Architecting schema..." });

        // 👁️ Vision Plan
        if (image && genAI) {
            const geminiVisionModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash", generationConfig: { responseMimeType: "application/json" } });
            const imagePart = { inlineData: { data: image.split(',')[1], mimeType: image.split(';')[0].split(':')[1] } };
            const visionPrompt = `Analyze this UI. Request: "${finalPrompt}". Return ONLY JSON: { "tech_stack": "...", "files_needed": ["index.html"], "dependencies": [] }`;
            const visionRes = await geminiVisionModel.generateContent([visionPrompt, imagePart]);
            masterData = extractJson(visionRes.response.text());
        } else {
            // 🧠 Normal Plan
            const masterPrompt = `You are an Elite Architect. Request: "${finalPrompt}". 
            If requested full-stack, include "docker-compose.yml" and "Dockerfile".
            Return ONLY JSON format: { "tech_stack": "...", "files_needed": ["index.html"], "dependencies": [] }`;
            try {
                const masterRes = await groq.chat.completions.create({ messages: [{ role: 'system', content: masterPrompt }], model: MASTER_MODEL, temperature: 0.1, response_format: { type: 'json_object' } });
                masterData = JSON.parse(masterRes.choices[0].message.content);
            } catch (e) {
                const backupMaster = await safeGenerate(masterPrompt + " MUST RETURN JSON.", true);
                masterData = extractJson(backupMaster.text);
            }
        }

        const techStack = masterData?.tech_stack || "HTML/CSS/JS";
        const filesToGenerate = masterData?.files_needed || ["index.html"];
        sendEvent('log', { agent: "System Architect", status: "Stack Locked", details: `Generating ${filesToGenerate.length} files.` });

        // 🧠 Memory Injector
        let memoryString = "";
        if (contextFiles && Object.keys(contextFiles).length > 0) {
            memoryString = "\n\n[PROJECT MEMORY:\n";
            for (const [fname, fcode] of Object.entries(contextFiles)) { memoryString += `--- ${fname} ---\n${fcode.substring(0, 1500)}...\n`; }
            memoryString += "]\nEnsure new code connects flawlessly.";
        }

        // 💻 Worker Loop
        for (const filename of filesToGenerate) {
            try {
                sendEvent('log', { agent: `${techStack} Dev`, status: "Deep Coding", details: `Writing logic for ${filename}...` });
                
                const workerPrompt = `You are a strict code generator. Context: "${finalPrompt}". ${memoryString}
                🚨 CRITICAL REQUIREMENT:
                1. Write ONLY the code for ${filename}.
                2. DO NOT include text like "Here is the code" or "Sure!".
                3. ALWAYS wrap the code in a markdown block (e.g. \`\`\`javascript \`\`\`).`;
                
                const generatedData = await safeGenerate(workerPrompt, false, sendEvent); 
                
                // 🔥 Filtering the code
                let currentCode = cleanRawCode(generatedData.text);
                
                const absoluteFilePath = path.join(WORKSPACE_DIR, filename);
                await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true });
                await fs.writeFile(absoluteFilePath, currentCode);

                sendEvent('file', { filename: filename, code: currentCode });
                sendEvent('log', { agent: `${generatedData.engine} Worker`, status: "File Generated", details: `${filename} successfully written.` });
            } catch (fileError) {
                sendEvent('log', { agent: "System Crash", status: "Error", details: `Failed on ${filename}.` });
            }
        }

        sendEvent('log', { agent: "Deployment Manager", status: "Success", details: `Project architecture complete!` });
        sendEvent('done', { success: true });
        res.end();
    } catch (error) {
        sendEvent('error', { error: `Swarm Error: ${error.message}` });
        res.end();
    }
});

// ==========================================
// ▶️ PYTHON SANDBOX API
// ==========================================
app.post('/api/run', async (req, res) => {
    const { code, filename } = req.body;
    if (!filename.endsWith('.py')) return res.json({ error: "Sandbox currently supports Python (.py) files only." });
    try {
        const tempPath = path.join(__dirname, 'temp_sandbox.py');
        await fs.writeFile(tempPath, code);
        const { stdout, stderr } = await execPromise(`python3 ${tempPath}`);
        res.json({ output: stdout || "Script executed successfully with no output.", error: stderr });
    } catch (err) { res.json({ error: err.message, output: err.stdout || err.stderr }); }
});

// ==========================================
// 🐙 GITHUB DEPLOY API
// ==========================================
app.post('/api/deploy', async (req, res) => {
    const { token, repoName } = req.body;
    if (!token || !repoName) return res.status(400).json({ error: "Missing Config." });
    try {
        const gitCommands = `cd ${WORKSPACE_DIR} && git init && git add . && git commit -m "Initial commit" && git branch -M main && git remote add origin https://${token}@github.com/mantupatra23-pixel/${repoName}.git && git push -u origin main --force`;
        await execPromise(gitCommands);
        res.json({ success: true, url: `https://github.com/mantupatra23-pixel/${repoName}` });
    } catch (err) { res.json({ error: "Deploy Failed.", details: err.message }); }
});

// ==========================================
// 🩺 STATUS CHECK API
// ==========================================
app.get('/api/env', (req, res) => res.json({ success: true, variables: { MANTU_AI_STATUS: "FINAL FULL BACKEND V5 ACTIVE" } }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Mantu AI Server running on port ${PORT}...`));
