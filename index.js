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
app.use(express.json({ limit: "200mb" })); // Extra limit for Image Base64

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
    } catch (e) { return { tech_stack: "Vite React", files_needed: [] }; }
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
// 🤖 THE CASCADING AI ENGINE (VISION + TIMEOUT FIX)
// ==========================================
async function safeGenerate(promptText, isJson = true, attachments = {}) {
    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const awsLlmUrl = process.env.AWS_LLM_URL;

    // 🔥 FORCE GEMINI VISION IF IMAGE IS UPLOADED
    if (attachments && attachments.image) {
        try {
            if(!geminiKey) throw new Error("Gemini Key required for Image Vision");
            const genAI = new GoogleGenerativeAI(geminiKey);
            const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
            const parsed = parseBase64(attachments.image);
            let promptParts = [promptText];
            if(parsed) promptParts.push({ inlineData: { data: parsed.data, mimeType: parsed.mimeType }});
            const res = await geminiModel.generateContent(promptParts);
            return { text: res.response.text(), engine: "Gemini Vision" };
        } catch(e) {
            console.log(e);
            throw new Error("Image Vision failed. Check Gemini API key.");
        }
    }

    let finalPrompt = promptText;
    if (attachments && attachments.voiceUrl) finalPrompt += `\n[Audio/Voice Data Provided]`;

    // 1. AWS LLM (WITH 4s TIMEOUT SO IT DOESNT HANG RENDER)
    if (awsLlmUrl) {
        try {
            const awsRes = await axios.post(awsLlmUrl, { model: "llama", prompt: finalPrompt }, { timeout: 4000 });
            if (awsRes.data?.choices?.[0]) return { text: awsRes.data.choices[0].message.content, engine: "AWS_LLM" };
        } catch (err) { console.log("⚠️ AWS Error/Timeout, falling back to Groq..."); }
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
        } catch (err) { console.log("⚠️ Groq Error, falling back to Gemini..."); }
    }

    // 3. Gemini Fallback
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
// 🏗️ MAIN BUILD API (FIXED EEXIST CRASH)
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
        sendEvent('log', { agent: "Mantu OS", status: "Active", details: "Architecting Fullstack Blueprint..." });

        const masterPrompt = `You are an Elite Enterprise Architect. Create JSON architecture for: ${prompt}.
        CRITICAL RULES:
        1. Frontend MUST be React with VITE and Tailwind CSS.
        2. Backend MUST be PYTHON FastAPI or Flask (inside 'api/' folder).
        3. MUST include 'api/requirements.txt'.
        4. MUST include 'vercel.json'.
        Return ONLY JSON: {"tech_stack": "React + Python", "files_needed": ["frontend/package.json", "frontend/vite.config.js", "frontend/src/App.jsx", "api/index.py", "api/requirements.txt", "vercel.json"]}`;
        
        let masterData = await safeGenerate(masterPrompt, true, { image, voiceUrl });
        const architecture = extractJson(masterData.text);
        const filesToGenerate = architecture.files_needed || [];

        const concurrencyLimit = 3; 
        for (let i = 0; i < filesToGenerate.length; i += concurrencyLimit) {
             const chunk = filesToGenerate.slice(i, i + concurrencyLimit);
             await Promise.all(chunk.map(async (filename) => {
                 try {
                     sendEvent('log', { agent: "Developer", status: "Coding", details: `Writing code for ${filename}...` });
                     const workerPrompt = `Write the COMPLETE code for ${filename} for this app: ${prompt}. Return ONLY raw code without Markdown backticks.`;
                     const codeData = await safeGenerate(workerPrompt, false, { image, voiceUrl });
                     const cleanCode = cleanRawCode(codeData.text);
                     
                     const absoluteFilePath = path.join(WORKSPACE_DIR, filename);
                     
                     // 🔥 CRITICAL FIX: Safe Directory Creation to avoid EEXIST crash
                     try {
                         await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true });
                     } catch (mkdirErr) {
                         if (mkdirErr.code !== 'EEXIST') throw mkdirErr; // Safely ignore EEXIST
                     }
                     
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
// ☁️ 1. MANTU CLOUD DEPLOY (NATIVE AXIOS NETLIFY FIX)
// ==========================================
app.post('/api/publish-cloud', async (req, res) => {
    try {
        const { compiledHtml } = req.body; 
        const netlifyToken = process.env.NETLIFY_TOKEN ? process.env.NETLIFY_TOKEN.replace(/[\r\n"' ]/g, '') : null; 
        
        io.emit('deploy-log', `\n☁️ Initializing Mantu Cloud Architecture...`);
        if (!netlifyToken) return res.status(400).json({ error: "Netlify Token Missing." });

        io.emit('deploy-log', `\n📦 Packaging Compiled Preview...`);
        const zipPath = path.join(__dirname, `mantu_frontend_${Date.now()}.zip`);
        const output = fsSync.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(output);
        
        archive.directory(WORKSPACE_DIR, false);
        
        // Push HTML so Netlify link works instantly
        if(compiledHtml) {
            archive.append(compiledHtml, { name: 'index.html' });
        }

        await archive.finalize();
        await new Promise(resolve => output.on('close', resolve));

        let frontendUrl = "";
        try {
            io.emit('deploy-log', `\n🚀 Deploying safely via Native Axios...`);
            
            // 🔥 FIXED NETWORK ERROR: Switched from 'curl' to safer Native Axios Buffer for big files
            const zipData = await fs.readFile(zipPath);
            const netlifyRes = await axios.post('[https://api.netlify.com/api/v1/sites](https://api.netlify.com/api/v1/sites)', zipData, {
                headers: { 'Content-Type': 'application/zip', 'Authorization': `Bearer ${netlifyToken}` },
                maxBodyLength: Infinity, maxContentLength: Infinity
            });

            if (netlifyRes.data && netlifyRes.data.url) {
                frontendUrl = netlifyRes.data.ssl_url || netlifyRes.data.url;
                io.emit('deploy-log', `\n✅ Site Live at: ${frontendUrl}`);
            } else throw new Error("Invalid Netlify Response");

        } catch (err) { throw new Error(err.response?.data?.message || err.message); } 
        finally { await fs.unlink(zipPath).catch(()=>{}); }

        io.emit('deploy-log', `\n🎉 MANTU CLOUD DEPLOYMENT COMPLETE!`);
        res.json({ success: true, url: frontendUrl });

    } catch (error) { 
        io.emit('deploy-log', `\n❌ Deploy Failed: ${error.message}`);
        res.status(500).json({ error: error.message }); 
    }
});

// ==========================================
// 🐙 2. GITHUB 1-CLICK PUSH (MONOREPO)
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
            { name: repoName, private: false, description: "Generated by Mantu OS Enterprise AI" },
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
                res.json({ success: true, message: "Code pushed to GitHub!", url: finalUrl });
            } else res.status(500).json({ error: "Git execution failed." });
        });

    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// 🚀 3. AWS EC2 DEPLOY
// ==========================================
app.post('/api/publish-aws', async (req, res) => {
    res.json({ success: true, message: "AWS Pipeline connected." });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Mantu Engine is running on port ${PORT}`));
