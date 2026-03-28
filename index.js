const express = require('express');
const cors = require('cors');
const fs = require('fs/promises'); 
const fsSync = require('fs'); 
const path = require('path'); 
const archiver = require('archiver'); 
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

// Ensures workspace directory exists
if (!fsSync.existsSync(WORKSPACE_DIR)){
    fsSync.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

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
    const match = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
    if (match && match[1]) return match[1].trim();
    
    let clean = text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');
    clean = clean.replace(/^(Here is|Sure|This is|Below is|The code).*?[\r\n]/gi, '');
    clean = clean.replace(/^["'\*]*[a-zA-Z0-9_\-\.\/]+["'\*]*\s*[\r\n]/gm, '');
    return clean.trim();
};

// 🤖 1. MANTU AI ENGINE (Failover System)
async function safeGenerate(promptText, isJson = true, sendEvent = null, customConfig = {}) {
    const awsUrl = customConfig.awsIp ? `http://${customConfig.awsIp}:8000/chat` : (process.env.AWS_API_URL || "http://localhost:8000/chat");
    const groqKey = customConfig.groqKey || process.env.GROQ_API_KEY;
    const geminiKey = customConfig.geminiKey || process.env.GEMINI_API_KEY;

    try {
        const finalUrl = `${awsUrl}?prompt=${encodeURIComponent(promptText)}`;
        if(sendEvent) sendEvent('log', { agent: "AWS GPU", status: "Computing", details: `Trying ${awsUrl}...` });
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); 
        const awsRes = await fetch(finalUrl, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": "mantu_godmode_secure_999" }, signal: controller.signal });
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
            const groqRes = await groq.chat.completions.create({ messages: [ { role: 'system', content: isJson ? "Output JSON only." : "Output ONLY raw code." }, { role: 'user', content: promptText } ], model: MASTER_MODEL, temperature: 0.2, response_format: isJson ? { type: 'json_object' } : null });
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

// 🏗️ 2. BUILD API (AI Code Generation)
app.post('/api/build', async (req, res) => {
    let { prompt, image, contextFiles, customSettings } = req.body; 
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const sendEvent = (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

    try {
        let finalPrompt = prompt;
        let masterData;
        sendEvent('log', { agent: "Omni-Master", status: "Planning Blueprint", details: "Architecting schema..." });

        const masterPrompt = `You are an Elite Architect. Request: "${finalPrompt}". 
        CRITICAL INSTRUCTION: You MUST ALWAYS include a ".env" file.
        If building a Node/React app, you MUST include a "package.json".
        If Database/Auth is requested, add Supabase/Firebase logic files.
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
                const workerPrompt = `Context: "${finalPrompt}". ${memoryString}
                🚨 CRITICAL REQUIREMENT:
                1. Write ONLY the code for ${filename}.
                2. NO EXPLANATIONS. Wrap in \`\`\`.
                3. DO NOT MINIFY THE CODE. Use \\n.`;
                
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
    } catch (error) { sendEvent('error', { error: `Error: ${error.message}` }); res.end(); }
});

// 🌍 3. MANTU CLOUD (Netlify Subdomain Deploy API)
app.post('/api/publish-cloud', async (req, res) => {
    const { files, netlifyToken } = req.body;

    if (!netlifyToken) {
        return res.json({ error: "CTO Sir, please add Netlify Token in Settings ⚙️ first!" });
    }

    const zipName = `mantu_deploy_${Date.now()}.zip`;
    const zipPath = path.join(__dirname, zipName);
    const output = fsSync.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } }); 

    output.on('close', async () => {
        try {
            const zipData = fsSync.readFileSync(zipPath);
            
            // Native Fetch API for deploying to Netlify
            const response = await fetch("https://api.netlify.com/api/v1/sites", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${netlifyToken}`,
                    "Content-Type": "application/zip"
                },
                body: zipData
            });

            const siteData = await response.json();
            fsSync.unlinkSync(zipPath); // Delete ZIP to save AWS Storage

            if (response.ok) {
                res.json({ success: true, url: siteData.ssl_url || siteData.url });
            } else {
                res.json({ error: `Cloud Error: ${siteData.message}` });
            }
        } catch (err) {
            res.json({ error: `Deploy Crash: ${err.message}` });
        }
    });

    archive.on('error', (err) => { 
        res.json({ error: `ZIP Error: ${err.message}` }); 
    });

    archive.pipe(output);

    for (const [filename, content] of Object.entries(files || {})) {
        archive.append(content, { name: filename });
    }
    
    archive.finalize();
});

// 🐙 4. GITHUB DEPLOY API
app.post('/api/publish-github', async (req, res) => {
    const { repoName, token, files } = req.body;
    // Logics for Github integration (Placeholders API)
    res.json({ success: true, url: `https://github.com/${repoName || 'mantu-app'}` });
});

// 💻 5. CODE EXECUTION / RUN SANDBOX (Missing tha, ab add ho gaya!)
app.post('/api/run', async (req, res) => {
    const { code, filename } = req.body;
    try {
        const filepath = path.join(WORKSPACE_DIR, filename || 'temp_script.js');
        await fs.mkdir(path.dirname(filepath), { recursive: true });
        await fs.writeFile(filepath, code);
        
        // Execute based on file extension
        let command = `node ${filepath}`;
        if (filename && filename.endsWith('.py')) {
            command = `python3 ${filepath}`;
        }
        
        const { stdout, stderr } = await execPromise(command);
        res.json({ output: stdout, error: stderr });
    } catch (error) {
        res.json({ error: error.message, output: '' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Mantu Cloud Backend running on port ${PORT}...`));
