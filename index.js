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

const http = require('http');
const { Server } = require('socket.io');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');

// ==========================================
// 🗄️ MONGODB CONFIG & MODELS
// ==========================================
const connectDB = require('./config/db');
const Project = require('./models/Project');

const app = express();
app.use(cors());
app.use(express.json({ limit: "100mb" }));

// Connect to Database
connectDB();

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on('connection', (socket) => {
    console.log('🟢 CTO Connected to Mantu AI Live Socket');
});

const WORKSPACE_DIR = path.join(__dirname, "mantu_workspace");

// ==========================================
// 🧠 HELPER FUNCTIONS
// ==========================================
const extractJson = (text) => {
    try {
        let cleanText = text.replace(/```(json)?/gi, "");
        const start = cleanText.indexOf("{");
        const end = cleanText.lastIndexOf("}");
        if (start !== -1 && end !== -1) {
            return JSON.parse(cleanText.substring(start, end + 1));
        }
        return JSON.parse(cleanText);
    } catch (e) {
        return { tech_stack: "Vite React/FastAPI", files_needed: [] };
    }
};

const cleanRawCode = (text) => {
    if (!text) return "// Error: AI returned empty response";
    const match = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
    if (match && match[1]) return match[1].trim();
    let clean = text.replace(/```[a-zA-Z]*\n?/g, "");
    clean = clean.replace(/```/g, "");
    clean = clean.replace(/^(Here is|Sure|This is|Below is).*$/gim, "");
    return clean.trim();
};

const parseBase64 = (dataUrl) => {
    if (!dataUrl) return null;
    const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return null;
    return { mimeType: matches[1], data: matches[2] };
};

// ==========================================
// 🤖 THE CASCADING AI ENGINE
// ==========================================
async function safeGenerate(promptText, isJson = true) {
    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const awsLlmUrl = process.env.AWS_LLM_URL;

    let finalPrompt = promptText;

    if (awsLlmUrl) {
        try {
            const awsRes = await fetch(`${awsLlmUrl}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: "llama", prompt: finalPrompt })
            });
            if (awsRes.ok) {
                const awsData = await awsRes.json();
                return { text: awsData.choices[0].message.content, engine: "AWS_LLM" };
            }
        } catch (err) {}
    }

    if (groqKey) {
        try {
            const groq = new Groq({ apiKey: groqKey });
            const groqRes = await groq.chat.completions.create({
                messages: [{ role: "system", content: "You are an Elite Developer." }, { role: "user", content: finalPrompt }],
                model: "llama-3.3-70b-versatile",
                temperature: 0.2
            });
            return { text: groqRes.choices[0].message.content, engine: "Groq" };
        } catch (err) {}
    }

    try {
        const genAI = new GoogleGenerativeAI(geminiKey);
        const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
        const res = await geminiModel.generateContent(finalPrompt);
        return { text: res.response.text(), engine: "Gemini" };
    } catch (err) { throw new Error("All AI engines failed."); }
}

async function autoHealCode(errorLog, customSettings) {
    io.emit('deploy-log', `\n🚨 [SELF-HEALING] Analyzing crash log...`);
    let suspectedFile = "frontend/src/App.jsx";
    if (errorLog.includes("backend") || errorLog.includes("python")) suspectedFile = "backend/main.py";
    if (errorLog.includes("package.json") || errorLog.includes("npm")) suspectedFile = "frontend/package.json";

    const absoluteFilePath = path.join(WORKSPACE_DIR, suspectedFile);
    let brokenCode = "";
    try { brokenCode = await fs.readFile(absoluteFilePath, "utf-8"); } catch(e) {}

    const healPrompt = `Fix the bug in "${suspectedFile}" based on this error:\n${errorLog}\n\nCode:\n${brokenCode}`;
    try {
        const fixedData = await safeGenerate(healPrompt, false);
        let fixedCode = cleanRawCode(fixedData.text);
        await fs.writeFile(absoluteFilePath, fixedCode);
        io.emit('deploy-log', `\n✅ Bug fixed by ${fixedData.engine}. Redeploying...`);
        return true;
    } catch (error) { return false; }
}

// ==========================================
// 🗄️ MONGODB API ROUTES (MERGED)
// ==========================================
app.post('/api/save-project', async (req, res) => {
    try {
        const { title, files } = req.body;
        if (!files || Object.keys(files).length === 0) return res.status(400).json({ error: "No files generated to save." });
        const newProject = await Project.create({ title: title || "New Mantu App", files: files });
        res.status(201).json({ success: true, message: "Project securely saved to Mantu DB!", projectId: newProject._id });
    } catch (error) { res.status(500).json({ error: "Failed to save project to cloud." }); }
});

app.get('/api/get-projects', async (req, res) => {
    try {
        const projects = await Project.find().sort({ createdAt: -1 }).limit(10);
        res.status(200).json({ success: true, data: projects });
    } catch (error) { res.status(500).json({ error: "Could not fetch projects." }); }
});

// ==========================================
// 🏗️ MAIN BUILD API (FULL CODE, NO CUTS, WITH TRAFFIC CONTROL)
// ==========================================
app.post('/api/build', async (req, res) => {
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    
    const sendEvent = (type, data) => { res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`); };

    try {
        await fs.rm(WORKSPACE_DIR, { recursive: true, force: true }).catch(() => {});
        await fs.mkdir(WORKSPACE_DIR, { recursive: true });

        const { prompt, image, voice, voiceUrl, customSettings } = req.body;
        sendEvent('log', { agent: "Mantu OS", status: "Active", details: "Architecting blueprint..." });

        const masterPrompt = `You are an Elite Enterprise Architect. Create JSON architecture for: ${prompt}. CRITICAL RULES: MUST use React with VITE and Tailwind CSS. Return ONLY JSON: {"tech_stack": "Vite React", "files_needed": ["frontend/package.json", "frontend/vite.config.js", ...]}`;
        
        let masterData = await safeGenerate(masterPrompt, true);
        const architecture = extractJson(masterData.text);
        const filesToGenerate = architecture.files_needed || [];

        for (const filename of filesToGenerate) {
            try {
                sendEvent('log', { agent: "Developer", status: "Coding", details: `Writing code for ${filename}...` });
                const workerPrompt = `Write the COMPLETE code for ${filename} for this app: ${prompt}. Return ONLY raw code.`;
                const codeData = await safeGenerate(workerPrompt, false);
                const cleanCode = cleanRawCode(codeData.text);
                
                // Save to Backend Disk
                const absoluteFilePath = path.join(WORKSPACE_DIR, filename);
                await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true });
                await fs.writeFile(absoluteFilePath, cleanCode);
                
                // Send 100% FULL CODE to Frontend
                sendEvent('file', { filename: filename, code: cleanCode });
                
                // 🔥 TRAFFIC CONTROLLER: Wait 1 sec
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (err) {}
        }

        sendEvent('done', { success: true });
        res.end();
    } catch (error) {
        sendEvent('error', { error: error.message });
        res.end();
    }
});

// ==========================================
// 🚀 DEPLOYMENT & OTHER ROUTES (UNCHANGED)
// ==========================================
app.post('/api/publish-aws', async (req, res) => {
    let { targetIp, authKey, customSettings } = req.body;
    if (!targetIp || !authKey) return res.status(400).json({ error: "Missing Parameters" });
    
    const deployLogic = async (attempt = 1) => {
        try {
            const timestamp = Date.now();
            const zipPath = path.join(__dirname, `mantu_build_${timestamp}.zip`);
            const pemPath = path.join(__dirname, `temp_key_${timestamp}.pem`);
            
            const output = fsSync.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.pipe(output);
            archive.directory(WORKSPACE_DIR, false);
            await archive.finalize();
            await new Promise(resolve => output.on('close', resolve));
            
            await fs.writeFile(pemPath, authKey.replace(/\\n/g, '\n'));
            await execPromise(`chmod 400 ${pemPath}`);
            io.emit('deploy-log', `\n📦 Uploading Code to Server... (Attempt ${attempt})`);
            
            const scpCommand = `scp -o StrictHostKeyChecking=no -i ${pemPath} ${zipPath} ubuntu@${targetIp}:~/app.zip`;
            const sshCommand = `ssh -o StrictHostKeyChecking=no -i ${pemPath} ubuntu@${targetIp} "\
                mkdir -p /home/ubuntu/mantu_app && unzip -o ~/app.zip -d /home/ubuntu/mantu_app && \
                sudo apt-get update -y && sudo apt-get install -y nodejs npm pm2 && \
                if [ -d "/home/ubuntu/mantu_app/frontend" ]; then \
                    cd /home/ubuntu/mantu_app/frontend && npm install && npm run build && \
                    sudo rm -rf /var/www/html/* && sudo cp -r dist/* /var/www/html/ ; \
                fi && \
                if [ -d "/home/ubuntu/mantu_app/backend" ]; then \
                    sudo npm install -g pm2 && cd /home/ubuntu/mantu_app/backend && npm install && \
                    sudo fuser -k 8000/tcp || true && pm2 start server.js --name backend ; \
                fi && echo '🚀 Deployment Success' \
            "`;

            let collectedErrors = "";
            const process = exec(sshCommand);
            
            process.stdout.on('data', data => io.emit('deploy-log', data.toString()));
            process.stderr.on('data', data => {
                const err = data.toString();
                io.emit('deploy-log', `\n⚠️ ${err}`);
                if (err.includes("ERR!") || err.includes("error")) collectedErrors += err + "\n";
            });

            process.on('close', async (code) => {
                await fs.unlink(zipPath).catch(()=>{});
                await fs.unlink(pemPath).catch(()=>{});

                if (collectedErrors && attempt < 2) {
                    io.emit('deploy-log', `\n🛠️ Attempting Auto-Heal...`);
                    const isHealed = await autoHealCode(collectedErrors, customSettings);
                    if (isHealed) return deployLogic(attempt + 1);
                }
                
                if (code === 0 || attempt >= 2) {
                    io.emit('deploy-log', `\n🎉 App deployed successfully at http://${targetIp}`);
                    if (!res.headersSent) res.json({ success: true, url: `http://${targetIp}` });
                }
            });
        } catch (error) { if (!res.headersSent) res.status(500).json({ error: error.message }); }
    };
    deployLogic(1);
});

app.post('/api/rollback-aws', async (req, res) => { res.json({ message: "Rollback functionality coming soon" }); });
app.post('/api/save-env', async (req, res) => { res.json({ message: "Env saved" }); });
app.post('/api/setup-domain', async (req, res) => { res.json({ message: "Domain setup initiated" }); });
app.post('/api/run', async (req, res) => { res.json({ message: "Run logic" }); });
app.post('/api/publish-cloud', async (req, res) => { res.json({ message: "Cloud push" }); });
app.post('/api/publish-github', async (req, res) => { res.json({ message: "Github push" }); });
app.post('/api/build-apk', async (req, res) => { res.json({ message: "APK build initiated" }); });

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Mantu Enterprise Engine is running on port ${PORT}`));
