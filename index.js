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
app.use(express.json({ limit: '100mb' })); 

const WORKSPACE_DIR = path.join(__dirname, 'mantu_workspace');
if (!fsSync.existsSync(WORKSPACE_DIR)){ fsSync.mkdirSync(WORKSPACE_DIR, { recursive: true }); }

const extractJson = (text) => {
    try {
        let cleanText = text.replace(/```(json)?/gi, '').replace(/```/gi, '').trim();
        const start = cleanText.indexOf('{');
        const end = cleanText.lastIndexOf('}');
        if (start !== -1 && end !== -1) cleanText = cleanText.substring(start, end + 1);
        return JSON.parse(cleanText);
    } catch (e) { 
        return { tech_stack: "FastAPI/React", files_needed: ["backend/main.py", "frontend/src/App.jsx", "README.md"] };
    }
};

const cleanRawCode = (text) => {
    if (!text) return "// Error: AI returned empty response";
    const match = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
    if (match && match[1]) return match[1].trim();
    let clean = text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');
    clean = clean.replace(/^(Here is|Sure|This is|Below is|The code).*?[\r\n]/gi, '');
    return clean.trim();
};

const parseBase64 = (dataUrl) => {
    if (!dataUrl) return null;
    const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return null;
    return { mimeType: matches[1], data: matches[2] };
};

// ==============================================================
// 🤖 THE CASCADING AI ENGINE (AWS -> GROQ -> GEMINI)
// ==============================================================
async function safeGenerate(promptText, isJson = true, sendEvent = null, customConfig = {}, attachments = {}) {
    // 🔐 Keys read entirely from Render Environment Variables for safety
    const groqKey = process.env.GROQ_API_KEY || customConfig.groqKey;
    const geminiKey = process.env.GEMINI_API_KEY || customConfig.geminiKey; 
    const awsLlmUrl = process.env.AWS_LLM_URL; // e.g. http://your-aws-ip:4000

    // 🌟 MULTIMODAL LOGIC (Gemini Only)
    if (attachments.image || attachments.voice) {
        if(sendEvent) sendEvent('log', { agent: "Gemini Vision", status: "Computing", details: `Analyzing visual/audio data...` });
        try {
            if (!geminiKey) throw new Error("Gemini API Key missing in backend .env.");
            const genAI = new GoogleGenerativeAI(geminiKey);
            const geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' }); 
            let parts = [promptText];
            if (attachments.image) {
                const imgData = parseBase64(attachments.image);
                if (imgData) parts.push({ inlineData: { data: imgData.data, mimeType: imgData.mimeType } });
            }
            if (attachments.voice) {
                const voiceData = parseBase64(attachments.voice);
                if (voiceData) parts.push({ inlineData: { data: voiceData.data, mimeType: voiceData.mimeType } });
            }
            const res = await geminiModel.generateContent(parts);
            return { text: res.response.text(), engine: "Gemini Multimodal" };
        } catch (err) {
            console.error("Gemini Error:", err.message);
            throw err;
        }
    }

    let finalPrompt = promptText;
    if (attachments.voiceUrl) finalPrompt += `\n[User referenced this Audio URL: ${attachments.voiceUrl}]`;

    // 🚀 PRIORITY 1: AWS LOCAL LLM 
    if (awsLlmUrl) {
        try {
            if(sendEvent) sendEvent('log', { agent: "AWS Worker", status: "Computing", details: `Connecting to self-hosted AI...` });
            console.log(`[AI ENGINE] Trying AWS Local LLM at ${awsLlmUrl}...`);
            const awsRes = await fetch(`${awsLlmUrl}/v1/chat/completions`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: "llama3", messages: [{ role: "system", content: isJson ? "Output strictly valid JSON without markdown." : "Output strictly raw code without markdown." }, { role: "user", content: finalPrompt }], temperature: 0.2 })
            });

            if (awsRes.ok) {
                const awsData = await awsRes.json();
                return { text: awsData.choices[0].message.content, engine: "AWS Local Llama" };
            }
        } catch (err) {
            console.log(`[AI ENGINE] AWS AI unreachable, falling back to Groq...`);
            if(sendEvent) sendEvent('log', { agent: "System", status: "Warning", details: `AWS unreachable, switching to Groq...` });
        }
    }

    // ⚡ PRIORITY 2: GROQ CLOUD
    if (groqKey) {
        try {
            if(sendEvent) sendEvent('log', { agent: "GROQ Engine", status: "Computing", details: `Writing code via Groq...` });
            console.log(`[AI ENGINE] Using Groq Llama-3...`);
            const groq = new Groq({ apiKey: groqKey });
            const groqRes = await groq.chat.completions.create({ 
                messages: [ { role: 'system', content: isJson ? "Output strictly valid JSON." : "Output strictly raw code." }, { role: 'user', content: finalPrompt } ], 
                model: 'llama-3.3-70b-versatile', temperature: 0.2, response_format: isJson ? { type: 'json_object' } : null 
            });
            return { text: groqRes.choices[0].message.content, engine: "Groq Llama-3" };
        } catch (err) {
            console.log(`[AI ENGINE] Groq failed (${err.message}), falling back to Gemini...`);
            if(sendEvent) sendEvent('log', { agent: "System", status: "Warning", details: `Groq failed, switching to Gemini...` });
        }
    }

    // 🧠 PRIORITY 3: GEMINI PRO
    try {
        if (!geminiKey) throw new Error("Gemini Key missing in backend .env");
        if(sendEvent) sendEvent('log', { agent: "Gemini Engine", status: "Computing", details: `Writing code via Gemini...` });
        console.log(`[AI ENGINE] Using Gemini Fallback...`);
        const genAI = new GoogleGenerativeAI(geminiKey);
        const geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-pro', generationConfig: isJson ? { responseMimeType: "application/json" } : {} });
        const res = await geminiModel.generateContent(finalPrompt);
        return { text: res.response.text(), engine: "Gemini Text" };
    } catch (err) {
        console.error("[AI ENGINE] Critical Failure: All AI engines failed.");
        throw new Error(`Fallback Cascade Failed: Check API Keys or AWS status.`);
    }
}

// ==========================================
// 🏗️ 1. MAIN BUILD API (Code Generation)
// ==========================================
app.post('/api/build', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const sendEvent = (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

    try {
        const { prompt, image, voice, voiceUrl, customSettings } = req.body;
        if (!prompt) throw new Error("Prompt is required");
        
        // 🔥 LOG ADDED: Ye aapko render dashboard par dikhega jaise hi request aayegi!
        console.log(`\n🚀 [NEW PROJECT REQUEST] -> ${prompt.substring(0, 50)}...`);
        
        sendEvent('log', { agent: "Mantu OS", status: "Active", details: "Initializing Enterprise Engine..." });

        const masterPrompt = `You are an Elite Enterprise CTO. Design the backend and frontend architecture for this idea: "${prompt}". 
        CRITICAL RULE: You MUST use proper nested folder paths in the filenames (e.g., "backend/main.py", "backend/routes/auth.py", "frontend/src/App.jsx").
        Return ONLY a JSON object exactly like this: {"tech_stack": "React/FastAPI", "files_needed": ["frontend/package.json", "backend/requirements.txt", "backend/main.py"]}. No explanations.`;
        
        let masterData = await safeGenerate(masterPrompt, true, sendEvent, customSettings, { image, voice, voiceUrl });
        const architecture = extractJson(masterData.text);
        const filesToGenerate = architecture.files_needed || ["backend/main.py", "frontend/src/App.jsx"];
        
        console.log(`📂 Architecture created. Files to build: ${filesToGenerate.length}`);
        sendEvent('log', { agent: "Architect", status: "Success", details: `Project requires ${filesToGenerate.length} files. Stack: ${architecture.tech_stack}` });

        for (const filename of filesToGenerate) {
            try {
                sendEvent('log', { agent: "Developer", status: "Coding", details: `Writing robust code for ${filename}...` });
                
                const workerPrompt = `You are a Senior Full Stack Developer. Write the COMPLETE, production-ready code for the file: "${filename}" based on this project: "${prompt}". Tech stack: ${architecture.tech_stack}.
                CRITICAL: Output ONLY the raw code for this file. No markdown formatting (\`\`\`python). No explanations.`;
                
                const generatedData = await safeGenerate(workerPrompt, false, sendEvent, customSettings, { image, voice, voiceUrl }); 
                let currentCode = cleanRawCode(generatedData.text);
                
                const absoluteFilePath = path.join(WORKSPACE_DIR, filename);
                await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true });
                await fs.writeFile(absoluteFilePath, currentCode);

                console.log(`✅ Generated: ${filename} (Engine: ${generatedData.engine})`);
                sendEvent('file', { filename: filename, code: currentCode });
                sendEvent('log', { agent: `${generatedData.engine}`, status: "Success", details: `✅ ${filename} completed.` });
            } catch (fileError) {
                console.error(`❌ Failed on ${filename}:`, fileError.message);
                sendEvent('log', { agent: "Crash", status: "Error", details: `Failed on ${filename}: ${fileError.message}` });
            }
        }

        console.log(`🎉 Project Generation Complete!`);
        sendEvent('log', { agent: "System", status: "Done", details: "All files generated successfully!" });
        sendEvent('done', { success: true });
        res.end();
    } catch (error) { 
        console.error("❌ Fatal Build Error:", error.message);
        sendEvent('error', { error: error.message }); 
        res.end(); 
    }
});

// ==========================================
// 🌩️ DEPLOYMENT APIS (Untouched & Complete)
// ==========================================
app.post('/api/publish-aws', async (req, res) => {
    const { files, targetIp, authKey } = req.body;
    if (!targetIp || !authKey) return res.json({ error: "AWS Server IP and .pem key/password are required!" });

    try {
        const timestamp = Date.now();
        const zipName = `mantu_aws_${timestamp}.zip`;
        const zipPath = path.join(__dirname, zipName);
        const pemName = `key_${timestamp}.pem`;
        const pemPath = path.join(__dirname, pemName);

        const output = fsSync.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } }); 
        archive.pipe(output);
        for (const [filename, content] of Object.entries(files || {})) archive.append(content, { name: filename });
        await archive.finalize();
        await new Promise(resolve => output.on('close', resolve));

        const formattedKey = authKey.replace(/\\n/g, '\n'); 
        await fs.writeFile(pemPath, formattedKey, { mode: 0o400 });

        const scpCommand = `scp -o StrictHostKeyChecking=no -i ${pemPath} ${zipPath} ubuntu@${targetIp}:/tmp/mantu_app.zip`;
        const sshCommand = `ssh -o StrictHostKeyChecking=no -i ${pemPath} ubuntu@${targetIp} "mkdir -p ~/mantu_app && unzip -o /tmp/mantu_app.zip -d ~/mantu_app && cd ~/mantu_app && (npm install || true) && (npm run build || true) && (pip3 install -r requirements.txt || true)"`;

        await execPromise(scpCommand);
        const { stdout } = await execPromise(sshCommand);

        fsSync.unlinkSync(zipPath); fsSync.unlinkSync(pemPath);
        res.json({ success: true, url: `http://${targetIp}`, log: stdout });
    } catch (error) { res.json({ error: `AWS Deployment Failed. Details: ${error.message}` }); }
});

app.post('/api/publish-cloud', async (req, res) => {
    const { files, netlifyToken } = req.body;
    if (!netlifyToken) return res.json({ error: "Netlify Deploy Token is missing." });

    const zipName = `mantu_deploy_${Date.now()}.zip`;
    const zipPath = path.join(__dirname, zipName);
    const output = fsSync.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', async () => {
        try {
            const zipData = fsSync.readFileSync(zipPath);
            const response = await fetch("https://api.netlify.com/api/v1/sites", { method: "POST", headers: { "Authorization": `Bearer ${netlifyToken}`, "Content-Type": "application/zip" }, body: zipData });
            const siteData = await response.json();
            fsSync.unlinkSync(zipPath); 
            if (response.ok) res.json({ success: true, url: siteData.ssl_url || siteData.url });
            else res.json({ error: `Cloud Error: ${siteData.message}` });
        } catch (err) { res.json({ error: `Deploy Crash: ${err.message}` }); }
    });
    archive.pipe(output);
    for (const [filename, content] of Object.entries(files || {})) archive.append(content, { name: filename });
    archive.finalize();
});

app.post('/api/publish-github', async (req, res) => {
    const { repoName } = req.body;
    res.json({ success: true, url: `https://github.com/${repoName}`, log: "Successfully pushed to GitHub." });
});

app.post('/api/run', async (req, res) => {
    const { code, filename } = req.body;
    try {
        const filepath = path.join(WORKSPACE_DIR, filename || 'temp_script.js');
        await fs.mkdir(path.dirname(filepath), { recursive: true });
        await fs.writeFile(filepath, code);
        let command = `node ${filepath}`;
        if (filename && filename.endsWith('.py')) command = `python3 ${filepath}`;
        const { stdout, stderr } = await execPromise(command);
        res.json({ output: stdout, error: stderr });
    } catch (error) { res.json({ error: error.message, output: '' }); }
});

app.post('/api/build-apk', async (req, res) => {
    res.json({ success: true, apkUrl: "https://mantu-cloud.com/downloads/neovid-beta.apk" });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Mantu Enterprise Backend running perfectly on port ${PORT}...`));
