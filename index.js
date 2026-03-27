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

const extractJson = (text) => {
    try {
        let cleanText = text.replace(/```(json)?/gi, '').replace(/```/gi, '').trim();
        const match = cleanText.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : JSON.parse(cleanText);
    } catch (e) { return null; }
};

const cleanRawCode = (text) => {
    if (!text) return "// Error: AI returned empty response";
    let clean = text;
    const firstTick = clean.indexOf("```");
    if (firstTick !== -1) {
        const lastTick = clean.lastIndexOf("```");
        clean = (lastTick > firstTick) ? clean.substring(firstTick, lastTick + 3) : clean.substring(firstTick);
    }
    clean = clean.replace(/```[a-zA-Z]*\n?/gi, '').replace(/```/gi, '');
    clean = clean.replace(/^(Here is|Sure|This is|Below is|The code).*?[\r\n]/gi, '');
    clean = clean.replace(/^["'\*]*[a-zA-Z0-9_\-\.\/]+["'\*]*\s*[\r\n]/gm, '');
    return clean.trim();
};

async function safeGenerate(promptText, isJson = true, sendEvent = null, customConfig = {}) {
    const awsUrl = customConfig.awsIp ? `http://${customConfig.awsIp}:8000/chat` : (process.env.AWS_API_URL || "http://localhost:8000/chat");
    const groqKey = customConfig.groqKey || process.env.GROQ_API_KEY;
    const geminiKey = customConfig.geminiKey || process.env.GEMINI_API_KEY;

    try {
        const finalUrl = `${awsUrl}?prompt=${encodeURIComponent(promptText)}`;
        if(sendEvent) sendEvent('log', { agent: "AWS GPU", status: "Computing", details: `Trying ${awsUrl}...` });

        const controller = new AbortController();
        // 🔥 FIX: Timeout reduced to 30 seconds to prevent eternal spinning!
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

app.post('/api/build', async (req, res) => {
    let { prompt, image, contextFiles, isAutoFix, customSettings, chatHistory } = req.body; 
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const sendEvent = (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

    try {
        if (isAutoFix) {
            prompt = `[AUTO-FIX] Fix bug: "${prompt}". Return ONLY code.`;
        }

        let historyContext = "";
        if (chatHistory && chatHistory.length > 0) historyContext = "\n[HISTORY]\n" + chatHistory.map(msg => `${msg.role}: ${msg.text}`).join("\n") + "\n";

        let finalPrompt = prompt + historyContext;
        let masterData;
        sendEvent('log', { agent: "Omni-Master", status: "Planning Blueprint", details: "Architecting schema..." });

        // 🔥 FIX: Added requirements.txt and .env explicitly to instructions
        const masterPrompt = `You are an Elite Architect. Request: "${finalPrompt}". 
        If requested Python/FastAPI/Backend, you MUST include "requirements.txt", ".env" (with dummy keys), and "docker-compose.yml".
        Return ONLY JSON: { "tech_stack": "...", "files_needed": ["index.html"], "dependencies": [] }`;
        
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
                const workerPrompt = `Context: "${finalPrompt}". ${memoryString}
                🚨 CRITICAL: Write ONLY code for ${filename}. NO EXPLANATIONS. NO HEADERS. Wrap in \`\`\`.`;
                
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

app.post('/api/run', async (req, res) => { res.json({output: "Code Run Engine Active."}); });
app.post('/api/deploy', async (req, res) => { res.json({success: true, url: "https://github.com/mantupatra23-pixel/" + req.body.repoName}); });
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}...`));
