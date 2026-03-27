const express = require('express');
const cors = require('cors');
const fs = require('fs/promises'); 
const path = require('path'); 
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai'); 
const Groq = require('groq-sdk');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); 

const WORKSPACE_DIR = './mantu_workspace';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const MASTER_MODEL = 'llama-3.3-70b-versatile'; 

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

// 🔥 SUPER CLEANER: Removes conversational junk and markdown
const cleanRawCode = (text) => {
    if (!text) return "// Error: AI returned empty response";
    
    // 1. Try to extract ONLY what is between backticks (```)
    const match = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
    if (match && match[1]) {
        return match[1].trim();
    }
    
    // 2. Fallback brute-force cleanup
    let clean = text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');
    clean = clean.replace(/^(Here is|Sure|This is|Below is|The code).*?[\r\n]/gi, '');
    clean = clean.replace(/^["'\*]*[a-zA-Z0-9_\-\.\/]+["'\*]*\s*[\r\n]/gm, '');
    return clean.trim();
};

// ==========================================
// 🧠 DYNAMIC TRI-ENGINE ROUTER (AWS -> Groq -> Gemini)
// ==========================================
async function safeGenerate(promptText, isJson = true, sendEvent = null, customConfig = {}) {
    const awsUrl = customConfig.awsIp ? `http://${customConfig.awsIp}:8000/chat` : (process.env.AWS_API_URL || "http://localhost:8000/chat");
    const groqKey = customConfig.groqKey || process.env.GROQ_API_KEY;
    const geminiKey = customConfig.geminiKey || process.env.GEMINI_API_KEY;

    try {
        const finalUrl = `${awsUrl}?prompt=${encodeURIComponent(promptText)}`;
        if(sendEvent) sendEvent('log', { agent: "AWS GPU", status: "Computing", details: `Trying ${awsUrl}...` });

        const controller = new AbortController();
        // 🔥 FAST TIMEOUT: Sirf 30 seconds wait karega AWS ka
        const timeoutId = setTimeout(() => controller.abort(), 30000); 
        
        const awsRes = await fetch(finalUrl, {
            method: "POST", headers: { "Content-Type": "application/json", "x-api-key": "mantu_godmode_secure_999" },
            signal: controller.signal 
        });
        clearTimeout(timeoutId); 

        if (!awsRes.ok) throw new Error("AWS Unreachable");
        const awsData = await awsRes.json();
        if(awsData.error) throw new Error(awsData.error);
        return { text: awsData.response, engine: "AWS GPU" };
        
    } catch (awsErr) {
        if(sendEvent) sendEvent('log', { agent: "Router", status: "Switching", details: `AWS Unreachable. Fast-switching to Groq...` });
        try {
            if (!groqKey) throw new Error("No Groq Key");
            const groq = new Groq({ apiKey: groqKey });
            await sleep(1000); 
            const groqRes = await groq.chat.completions.create({ 
                messages: [ { role: 'system', content: isJson ? "Output JSON only." : "Output ONLY raw code." }, { role: 'user', content: promptText } ], 
                model: MASTER_MODEL, temperature: 0.2, response_format: isJson ? { type: 'json_object' } : null
            });
            return { text: groqRes.choices[0].message.content, engine: "Groq" };
        } catch (groqErr) {
            try {
                if (!geminiKey) throw new Error("No Gemini Key");
                const genAI = new GoogleGenerativeAI(geminiKey);
                const geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash', generationConfig: isJson ? { responseMimeType: "application/json" } : {} });
                const res = await geminiModel.generateContent(promptText);
                return { text: res.response.text(), engine: "Gemini" };
            } catch (geminiErr) { throw new Error("ALL ENGINES FAILED."); }
        }
    }
}

// ==========================================
// 🚀 MAIN BUILD API (Streaming)
// ==========================================
app.post('/api/build', async (req, res) => {
    let { prompt, image, contextFiles, isAutoFix, customSettings, chatHistory } = req.body; 
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const sendEvent = (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

    try {
        if (isAutoFix) {
            prompt = `[AUTO-FIX] Fix bug: "${prompt}". Return ONLY code.`;
        }

        let historyContext = "";
        if (chatHistory && chatHistory.length > 0) {
            historyContext = "\n[HISTORY]\n" + chatHistory.map(msg => `${msg.role}: ${msg.text}`).join("\n") + "\n";
        }

        let finalPrompt = prompt + historyContext;
        let masterData;
        sendEvent('log', { agent: "Omni-Master", status: "Planning Blueprint", details: "Architecting schema..." });

        // 🔥 STRICT RULE FOR .ENV AND REQUIREMENTS 🔥
        const masterPrompt = `You are an Elite Architect. Request: "${finalPrompt}". 
        CRITICAL INSTRUCTION: You MUST ALWAYS include a ".env" file with the required environment variables (keep values empty or use placeholders).
        If building a Node/React app, you MUST include a "package.json".
        If building a Python app, you MUST include a "requirements.txt".
        Return ONLY JSON: { "tech_stack": "...", "files_needed": ["index.html", ".env"], "dependencies": [] }`;
        
        try {
            const groq = new Groq({ apiKey: customSettings?.groqKey || process.env.GROQ_API_KEY });
            const masterRes = await groq.chat.completions.create({ messages: [{ role: 'system', content: masterPrompt }], model: MASTER_MODEL, temperature: 0.1, response_format: { type: 'json_object' } });
            masterData = JSON.parse(masterRes.choices[0].message.content);
        } catch (e) {
            const backupMaster = await safeGenerate(masterPrompt + " MUST RETURN JSON.", true, sendEvent, customSettings);
            masterData = extractJson(backupMaster.text);
        }

        const techStack = masterData?.tech_stack || "HTML/CSS/JS";
        const filesToGenerate = masterData?.files_needed || ["index.html"];
        sendEvent('log', { agent: "Architect", status: "Stack Locked", details: `Generating ${filesToGenerate.length} files.` });

        let memoryString = "";
        if (contextFiles && Object.keys(contextFiles).length > 0) {
            memoryString = "\n[MEMORY:\n" + Object.entries(contextFiles).map(([fname, fcode]) => `--- ${fname} ---\n${fcode.substring(0, 1000)}...\n`).join("") + "]";
        }

        for (const filename of filesToGenerate) {
            try {
                sendEvent('log', { agent: `${techStack} Dev`, status: "Coding", details: `Writing ${filename}...` });
                
                // 🔥 ANTI-MINIFICATION INSTRUCTION 🔥
                const workerPrompt = `Context: "${finalPrompt}". ${memoryString}
                🚨 CRITICAL REQUIREMENT:
                1. Write ONLY the code for ${filename}.
                2. NO EXPLANATIONS. NO HEADERS. Wrap in \`\`\`.
                3. DO NOT MINIFY THE CODE. You MUST use proper indentation and newlines (\\n).`;
                
                const generatedData = await safeGenerate(workerPrompt, false, sendEvent, customSettings); 
                let currentCode = cleanRawCode(generatedData.text);
                
                const absoluteFilePath = path.join(WORKSPACE_DIR, filename);
                await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true });
                await fs.writeFile(absoluteFilePath, currentCode);

                sendEvent('file', { filename: filename, code: currentCode });
                sendEvent('log', { agent: `${generatedData.engine} Worker`, status: "Success", details: `${filename} written.` });
            } catch (fileError) {
                sendEvent('log', { agent: "Crash", status: "Error", details: `Failed on ${filename}.` });
            }
        }

        sendEvent('done', { success: true });
        res.end();
    } catch (error) {
        sendEvent('error', { error: `Error: ${error.message}` });
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
app.get('/api/env', (req, res) => res.json({ success: true, variables: { MANTU_AI_STATUS: "FINAL GOD MODE BACKEND ACTIVE" } }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Mantu AI Server running on port ${PORT}...`));
