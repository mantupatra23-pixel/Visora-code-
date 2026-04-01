const express = require('express');
const cors = require('cors');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const archiver = require('archiver');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const axios = require('axios');
require('dotenv').config();

const http = require('http');
const { Server } = require('socket.io');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');

// ==========================================
// 🔐 AUTH & DATABASE IMPORTS
// ==========================================
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const connectDB = require('./config/db');
const Project = require('./models/Project');

const app = express();
app.use(cors());
app.use(express.json({ limit: "100mb" }));

// 🚀 Start Mantu DB
connectDB();

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on('connection', (socket) => {
    console.log('🟢 CTO Connected to Mantu AI Live Socket');
});

const WORKSPACE_DIR = path.join(__dirname, "mantu_workspace");
const JWT_SECRET = process.env.JWT_SECRET || "mantu_ai_super_secret_key_2026";

// ==========================================
// 🧠 HELPER FUNCTIONS
// ==========================================
const extractJson = (text) => {
    try {
        let cleanText = text.replace(/```(json)?/gi, "");
        const start = cleanText.indexOf("{");
        const end = cleanText.lastIndexOf("}");
        if (start !== -1 && end !== -1) return JSON.parse(cleanText.substring(start, end + 1));
        return JSON.parse(cleanText);
    } catch (e) { return { tech_stack: "Vite React + Python Serverless", files_needed: [] }; }
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

// ==========================================
// 🤖 THE CASCADING AI ENGINE (1. AWS -> 2. Groq -> 3. Gemini)
// ==========================================
async function safeGenerate(promptText, isJson = true, attachments = {}) {
    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const awsLlmUrl = process.env.AWS_LLM_URL;

    let finalPrompt = promptText;
    if (attachments && attachments.voiceUrl) finalPrompt += `\n[Audio/Voice Data Provided]`;
    if (attachments && attachments.image) finalPrompt += `\n[Image Context Provided]`;

    // 1. AWS LLM
    if (awsLlmUrl) {
        try {
            const awsRes = await axios.post(awsLlmUrl, { model: "llama", prompt: finalPrompt });
            if (awsRes.data?.choices?.[0]) return { text: awsRes.data.choices[0].message.content, engine: "AWS_LLM" };
        } catch (err) { console.log("⚠️ AWS Error, falling back..."); }
    }

    // 2. Groq
    if (groqKey) {
        try {
            const groq = new Groq({ apiKey: groqKey });
            const groqRes = await groq.chat.completions.create({
                messages: [{ role: "system", content: "You are an Elite Enterprise Developer." }, { role: "user", content: finalPrompt }],
                model: "llama-3.3-70b-versatile",
                temperature: 0.2
            });
            return { text: groqRes.choices[0].message.content, engine: "Groq" };
        } catch (err) { console.log("⚠️ Groq Error, falling back..."); }
    }

    // 3. Gemini
    try {
        if(!geminiKey) throw new Error("No Gemini Key Provided");
        const genAI = new GoogleGenerativeAI(geminiKey);
        const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" }); 
        const res = await geminiModel.generateContent(finalPrompt);
        return { text: res.response.text(), engine: "Gemini" };
    } catch (err) { throw new Error(`All AI failed. Check API Keys.`); }
}

// ==========================================
// 🔐 AUTH & DB ROUTES
// ==========================================
app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        let existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ error: "User already exists!" });
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const newUser = await User.create({ name, email, password: hashedPassword, credits: 10 });
        const token = jwt.sign({ id: newUser._id, plan: newUser.plan }, JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({ success: true, token, user: { id: newUser._id, name: newUser.name, credits: newUser.credits } });
    } catch (error) { res.status(500).json({ error: "Signup Error" }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: "User not found!" });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: "Invalid Password." });
        const token = jwt.sign({ id: user._id, plan: user.plan }, JWT_SECRET, { expiresIn: '7d' });
        res.status(200).json({ success: true, token, user: { id: user._id, name: user.name, credits: user.credits } });
    } catch (error) { res.status(500).json({ error: "Login Error" }); }
});

app.post('/api/save-project', async (req, res) => {
    try {
        const { title, files, userId } = req.body;
        const newProject = await Project.create({ userId, title: title || "New Python+React App", files });
        res.status(201).json({ success: true, projectId: newProject._id });
    } catch (error) { res.status(500).json({ error: "Save Error" }); }
});

app.get('/api/get-projects', async (req, res) => {
    try {
        const { userId } = req.query;
        const projects = await Project.find({ userId }).sort({ createdAt: -1 }).limit(10);
        res.status(200).json({ success: true, data: projects });
    } catch (error) { res.status(500).json({ error: "Fetch Error" }); }
});

// ==========================================
// 🏗️ MAIN BUILD API (PYTHON + REACT MONOREPO)
// ==========================================
app.post('/api/build', async (req, res) => {
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    
    const heartbeat = setInterval(() => { res.write(`data: keepalive\n\n`); }, 15000);
    const sendEvent = (type, data) => { res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`); };

    try {
        await fs.rm(WORKSPACE_DIR, { recursive: true, force: true }).catch(() => {});
        await fs.mkdir(WORKSPACE_DIR, { recursive: true });

        const { prompt, image, voiceUrl } = req.body;
        sendEvent('log', { agent: "Mantu OS", status: "Active", details: "Architecting Python/React Fullstack Blueprint..." });

        // 🔥 THE MAGIC PROMPT: Forces Python Backend and React Frontend
        const masterPrompt = `You are an Elite Enterprise Architect. Create JSON architecture for: ${prompt}.
        CRITICAL RULES:
        1. Frontend MUST be React with VITE and Tailwind CSS (put files inside 'frontend/' folder).
        2. Backend MUST be PYTHON FastAPI or Flask (put files inside 'api/' folder).
        3. MUST include 'api/requirements.txt' containing all python packages (FastAPI, uvicorn, flask, etc) so Vercel can auto-install them.
        4. MUST include 'vercel.json' in the root directory to route frontend and /api to the python serverless functions.
        Return ONLY JSON: {"tech_stack": "React + Python Serverless", "files_needed": ["frontend/package.json", "frontend/vite.config.js", "frontend/src/App.jsx", "frontend/index.html", "api/index.py", "api/requirements.txt", "vercel.json"]}`;
        
        let masterData = await safeGenerate(masterPrompt, true, { image, voiceUrl });
        const architecture = extractJson(masterData.text);
        const filesToGenerate = architecture.files_needed || [];

        const concurrencyLimit = 3; 
        for (let i = 0; i < filesToGenerate.length; i += concurrencyLimit) {
             const chunk = filesToGenerate.slice(i, i + concurrencyLimit);
             await Promise.all(chunk.map(async (filename) => {
                 try {
                     sendEvent('log', { agent: "Developer", status: "Coding", details: `Writing code for ${filename}...` });
                     const workerPrompt = `Write the COMPLETE code for ${filename} for this fullstack app: ${prompt}. Return ONLY raw code without Markdown backticks.`;
                     const codeData = await safeGenerate(workerPrompt, false, { image, voiceUrl });
                     const cleanCode = cleanRawCode(codeData.text);
                     
                     const absoluteFilePath = path.join(WORKSPACE_DIR, filename);
                     try { await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true }); } 
                     catch (mkdirErr) { if (mkdirErr.code !== 'EEXIST') throw mkdirErr; }
                     
                     await fs.writeFile(absoluteFilePath, cleanCode);
                     sendEvent('file', { filename: filename, code: cleanCode });
                 } catch(err) { console.error(`Error generating ${filename}:`, err); }
             }));
        }
        sendEvent('done', { success: true });
    } catch (error) {
        sendEvent('error', { error: error.message });
    } finally {
        clearInterval(heartbeat);
        res.end();
    }
});

// ==========================================
// 🐙 GITHUB 1-CLICK PUSH (THE MAIN GITOPS DEPLOYER)
// ==========================================
app.post('/api/publish-github', async (req, res) => {
    const { githubToken, repoName } = req.body;
    if (!githubToken || !repoName) return res.status(400).json({ error: "Missing GitHub Token or Repo Name" });

    try {
        io.emit('deploy-log', `\n🐙 Connecting to GitHub API...`);
        const userRes = await axios.get('[https://api.github.com/user](https://api.github.com/user)', { headers: { 'Authorization': `token ${githubToken}` }});
        const username = userRes.data.login;
        io.emit('deploy-log', `\n👤 Authenticated as: @${username}`);
        io.emit('deploy-log', `\n📦 Creating Repository: ${repoName}...`);

        await axios.post('[https://api.github.com/user/repos](https://api.github.com/user/repos)', 
            { name: repoName, private: false, description: "Python Backend + React Frontend generated by Mantu OS 🚀" },
            { headers: { 'Authorization': `token ${githubToken}` } }
        ).catch(e => {}); 

        const repoUrl = `https://${githubToken}@github.com/${username}/${repoName}.git`;
        io.emit('deploy-log', `\n⚙️ Pushing Python/React Monorepo to GitHub...`);
        
        const gitCommands = `cd ${WORKSPACE_DIR} && rm -rf .git && git init && git config user.email "cto@mantu.ai" && git config user.name "Mantu Agent" && git add . && git commit -m "🚀 Automated Monorepo Architecture by Mantu OS" && git branch -M main && git remote add origin ${repoUrl} && git push -u origin main --force`;

        const process = exec(gitCommands);
        process.stdout.on('data', data => io.emit('deploy-log', data.toString()));
        process.stderr.on('data', data => io.emit('deploy-log', `> ${data.toString()}`));

        process.on('close', (code) => {
            if (code === 0) {
                const finalUrl = `https://github.com/${username}/${repoName}`;
                io.emit('deploy-log', `\n🎉 Successfully pushed to GitHub!`);
                io.emit('deploy-log', `\n⚡ NOW: Connect this Repo to Vercel. Vercel will automatically read api/requirements.txt and deploy the Python server!`);
                res.json({ success: true, message: "Code pushed to GitHub! Ready for Vercel/Netlify.", url: finalUrl });
            } else res.status(500).json({ error: "Git execution failed." });
        });

    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// 🚀 AWS EC2 DEPLOY (CTO EXCLUSIVE)
// ==========================================
app.post('/api/publish-aws', async (req, res) => {
    let { targetIp, authKey, customSettings } = req.body;
    if (!targetIp || !authKey) return res.status(400).json({ error: "Missing Parameters" });
    
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
        io.emit('deploy-log', `\n📦 Uploading Code to AWS Server...`);
        
        // AWS Auto-Install Logic for Python + Node
        const scpCommand = `scp -o StrictHostKeyChecking=no -i ${pemPath} ${zipPath} ubuntu@${targetIp}:~/app.zip`;
        const sshCommand = `ssh -o StrictHostKeyChecking=no -i ${pemPath} ubuntu@${targetIp} "\
            mkdir -p /home/ubuntu/mantu_app && unzip -o ~/app.zip -d /home/ubuntu/mantu_app && \
            sudo apt-get update -y && sudo apt-get install -y nodejs npm python3-pip python3-venv pm2 && \
            if [ -d "/home/ubuntu/mantu_app/frontend" ]; then \
                cd /home/ubuntu/mantu_app/frontend && npm install && npm run build && \
                sudo rm -rf /var/www/html/* && sudo cp -r dist/* /var/www/html/ ; \
            fi && \
            if [ -d "/home/ubuntu/mantu_app/api" ]; then \
                cd /home/ubuntu/mantu_app/api && pip3 install -r requirements.txt && \
                sudo fuser -k 8000/tcp || true && pm2 start 'uvicorn index:app --host 0.0.0.0 --port 8000' --name python_backend ; \
            fi && echo '🚀 AWS Deployment Success' \
        "`;

        const process = exec(sshCommand);
        process.stdout.on('data', data => io.emit('deploy-log', data.toString()));
        process.stderr.on('data', data => io.emit('deploy-log', `> ${data.toString()}`));

        process.on('close', async (code) => {
            await fs.unlink(zipPath).catch(()=>{}); await fs.unlink(pemPath).catch(()=>{});
            if (code === 0) res.json({ success: true, url: `http://${targetIp}` });
            else res.status(500).json({ error: "AWS deployment script failed." });
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Mantu Enterprise Engine is running on port ${PORT}`));
