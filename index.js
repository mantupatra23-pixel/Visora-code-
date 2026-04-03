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
// 🔐 AUTH & DATABASE
// ==========================================
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./models/User'); 
const connectDB = require('./config/db'); 
const Project = require('./models/Project'); 

const app = express();
app.use(cors());
app.use(express.json({ limit: "200mb" }));

connectDB();

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on('connection', (socket) => {
    console.log('🟢 CTO Connected to Mantu React Engine');
});

const WORKSPACE_DIR = path.join(__dirname, "mantu_workspace");
const JWT_SECRET = process.env.JWT_SECRET || "mantu_ai_super_secret_key_2026";

// ==========================================
// 🧠 HELPER FUNCTIONS
// ==========================================
const extractJson = (text) => {
    try {
        let cleanText = text.replace(/```(json)?/gi, "").trim();
        const start = cleanText.indexOf("{");
        const end = cleanText.lastIndexOf("}");
        if (start !== -1 && end !== -1) return JSON.parse(cleanText.substring(start, end + 1));
        return JSON.parse(cleanText);
    } catch (e) { 
        return { tech_stack: "React + Vite", files_needed: ["package.json", "vite.config.js", "index.html", "src/main.jsx", "src/index.css", "src/App.jsx"] }; 
    }
};

const cleanRawCode = (text) => {
    if (!text) return "// Output generation failed.";
    let clean = text;
    const match = clean.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
    if (match && match[1]) return match[1].trim();
    clean = clean.replace(/```[a-zA-Z]*\n?/g, "");
    clean = clean.replace(/```/g, "");
    return clean.trim();
};

const parseBase64 = (dataUrl) => {
    if (!dataUrl) return null;
    const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return null;
    return { mimeType: matches[1], data: matches[2] };
};

// ==========================================
// 🤖 THE STRICT AI SEQUENCE (1. AWS -> 2. GROQ -> 3. GEMINI)
// ==========================================
async function safeGenerate(promptText, isJson = true, attachments = {}) {
    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const awsLlmUrl = process.env.AWS_LLM_URL;

    const systemPrompt = "You are an Elite Frontend Developer. Write complete, production-ready React + Tailwind code. NEVER leave placeholders like '// logic here'.";

    if (attachments && attachments.image) {
        try {
            if(!geminiKey) throw new Error("Gemini Key required");
            const genAI = new GoogleGenerativeAI(geminiKey);
            const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest", systemInstruction: systemPrompt });
            const parsed = parseBase64(attachments.image);
            const res = await geminiModel.generateContent([promptText, { inlineData: { data: parsed.data, mimeType: parsed.mimeType } }]);
            return { text: res.response.text(), engine: "Gemini Vision" };
        } catch(e) { console.log("Vision Failed."); }
    }

    if (awsLlmUrl) {
        try {
            const awsRes = await axios.post(awsLlmUrl, { model: "llama", prompt: promptText }, { timeout: 25000 });
            if (awsRes.data?.choices?.[0]?.message?.content) {
                return { text: awsRes.data.choices[0].message.content, engine: "AWS_LLM" };
            }
        } catch (err) { console.log("⚠️ AWS Server Timeout or Offline. Falling back to Groq..."); }
    }

    if (groqKey) {
        try {
            const groq = new Groq({ apiKey: groqKey });
            const groqRes = await groq.chat.completions.create({
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: promptText }],
                model: "llama-3.3-70b-versatile",
                temperature: 0.1
            });
            return { text: groqRes.choices[0].message.content, engine: "Groq" };
        } catch (err) { console.log("⚠️ Groq Failed. Falling back to Gemini..."); }
    }

    try {
        const genAI = new GoogleGenerativeAI(geminiKey);
        const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest", systemInstruction: systemPrompt }); 
        const res = await geminiModel.generateContent(promptText);
        return { text: res.response.text(), engine: "Gemini" };
    } catch (err) { throw new Error(`All 3 AI Engines (AWS, Groq, Gemini) Failed.`); }
}

// ==========================================
// 🔐 FULL AUTHENTICATION ROUTES
// ==========================================
app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        let existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ error: "User already exists with this email!" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = await User.create({ name, email, password: hashedPassword, credits: 10 });
        const token = jwt.sign({ id: newUser._id, plan: newUser.plan }, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({
            success: true, message: "Account created successfully!", token,
            user: { id: newUser._id, name: newUser.name, email: newUser.email, credits: newUser.credits }
        });
    } catch (error) { res.status(500).json({ error: "Server Error during Signup." }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: "User not found!" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: "Invalid Credentials." });

        const token = jwt.sign({ id: user._id, plan: user.plan }, JWT_SECRET, { expiresIn: '7d' });
        
        res.status(200).json({
            success: true, message: "Logged in successfully!", token,
            user: { id: user._id, name: user.name, email: user.email, credits: user.credits }
        });
    } catch (error) { res.status(500).json({ error: "Server Error during Login." }); }
});

// ==========================================
// 🗄️ FULL DATABASE ROUTES
// ==========================================
app.post('/api/save-project', async (req, res) => {
    try {
        const { title, files, userId } = req.body;
        if (!files || Object.keys(files).length === 0) return res.status(400).json({ error: "No files generated to save." });
        const newProject = await Project.create({ userId: userId, title: title || "New Mantu App", files: files });
        res.status(201).json({ success: true, message: "Project securely saved to Mantu DB!", projectId: newProject._id });
    } catch (error) { res.status(500).json({ error: "Failed to save project to cloud." }); }
});

app.get('/api/get-projects', async (req, res) => {
    try {
        const { userId } = req.query;
        const query = userId ? { userId: userId } : {}; 
        const projects = await Project.find(query).sort({ createdAt: -1 }).limit(10);
        res.status(200).json({ success: true, data: projects });
    } catch (error) { res.status(500).json({ error: "Could not fetch projects." }); }
});

// ==========================================
// 🏗️ MAIN BUILD API
// ==========================================
app.post('/api/build', async (req, res) => {
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    
    const heartbeat = setInterval(() => { res.write(`data: keepalive\n\n`); }, 10000);
    const sendEvent = (type, data) => { res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`); };

    try {
        await fs.rm(WORKSPACE_DIR, { recursive: true, force: true }).catch(() => {});
        await fs.mkdir(WORKSPACE_DIR, { recursive: true });

        const { prompt, image, voiceUrl, existingFiles } = req.body;
        const isFollowUp = Object.keys(existingFiles || {}).length > 0;
        
        let filesToGenerate = [];

        if (isFollowUp) {
            sendEvent('log', { agent: "Mantu OS", status: "Active", details: "Processing UI Overhaul..." });
            filesToGenerate = Object.keys(existingFiles);
        } else {
            sendEvent('log', { agent: "Mantu OS", status: "Active", details: "Architecting React Blueprint..." });
            const masterPrompt = `Design a complete, modern REACT application for: "${prompt}".
            CRITICAL RULES:
            1. Use React + Vite + Tailwind CSS.
            2. Break UI into logical components inside 'src/components/'.
            Return ONLY a JSON object: {"tech_stack": "React + Vite", "files_needed": ["package.json", "vite.config.js", "tailwind.config.js", "index.html", "src/main.jsx", "src/index.css", "src/App.jsx", "src/components/Header.jsx"]}`;
            
            let masterData = await safeGenerate(masterPrompt, true, { image, voiceUrl });
            const architecture = extractJson(masterData.text);
            filesToGenerate = architecture.files_needed || [];
            
            const essentialFiles = ["src/App.jsx", "src/index.css", "package.json"];
            essentialFiles.forEach(f => { if(!filesToGenerate.includes(f)) filesToGenerate.push(f); });
        }

        const concurrencyLimit = 2; 
        for (let i = 0; i < filesToGenerate.length; i += concurrencyLimit) {
             const chunk = filesToGenerate.slice(i, i + concurrencyLimit);
             await Promise.all(chunk.map(async (filename) => {
                 try {
                     sendEvent('log', { agent: "Developer", status: "Coding", details: `Generating ${filename}...` });
                     
                     // 🔥 CRITICAL FIX: FORCING MOCK DATA INSIDE COMPONENTS TO PREVENT SCOPE COLLISION
                     const workerPrompt = `Write the COMPLETE code for '${filename}' for this React app: "${prompt}". 
                     Files available: [ ${filesToGenerate.join(', ')} ]
                     
                     💎 STRICT RULES TO PREVENT CRASHES:
                     1. 🚫 SCOPE COLLISION FIX: NEVER declare mock data (like 'const products = [...]') in the global scope outside the component. ALWAYS put your mock data INSIDE the component function.
                     2. PREVENT .map() CRASHES: ALWAYS use default empty arrays for props.
                     3. Include beautiful, realistic mock data (images, descriptions) INSIDE the component.
                     4. Do NOT wrap components in <Router> or <BrowserRouter>.
                     
                     Return ONLY raw code without Markdown.`;
                     
                     const codeData = await safeGenerate(workerPrompt, false, { image, voiceUrl });
                     const cleanCode = cleanRawCode(codeData.text);
                     
                     const absoluteFilePath = path.join(WORKSPACE_DIR, filename);
                     try { await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true }); } 
                     catch (mkdirErr) { if (mkdirErr.code !== 'EEXIST') throw mkdirErr; }
                     
                     await fs.writeFile(absoluteFilePath, cleanCode);
                     sendEvent('file', { filename: filename, code: cleanCode, engine: codeData.engine });
                 } catch(err) { console.error(`Error on ${filename}:`, err); }
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
// ☁️ FULL DEPLOY ROUTE (NETLIFY)
// ==========================================
app.post('/api/publish-cloud', async (req, res) => {
    try {
        const { compiledHtml } = req.body; 
        const netlifyToken = process.env.NETLIFY_TOKEN ? process.env.NETLIFY_TOKEN.replace(/[\r\n"' ]/g, '') : null; 
        
        io.emit('deploy-log', `\n☁️ Initializing Mantu Cloud Architecture...`);
        if (!netlifyToken) return res.status(400).json({ error: "Netlify Token Missing in .env" });

        const zipPath = path.join(__dirname, `mantu_frontend_${Date.now()}.zip`);
        const output = fsSync.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(output);
        
        archive.directory(WORKSPACE_DIR, false);
        
        if(compiledHtml) {
            archive.append(compiledHtml, { name: 'index.html' });
        }

        await archive.finalize();
        await new Promise(resolve => output.on('close', resolve));

        io.emit('deploy-log', `\n🚀 Deploying to Netlify Edge via Native cURL...`);
        
        const netlifyCmd = `curl -s -X POST -H "Content-Type: application/zip" -H "Authorization: Bearer ${netlifyToken}" --data-binary "@${zipPath}" https://api.netlify.com/api/v1/sites`;
        const { stdout } = await execPromise(netlifyCmd);
        const netlifyData = JSON.parse(stdout);
        
        await fs.unlink(zipPath).catch(()=>{}); 

        if (netlifyData.url) {
            io.emit('deploy-log', `\n🎉 MANTU CLOUD DEPLOYMENT COMPLETE!`);
            res.json({ success: true, url: netlifyData.ssl_url || netlifyData.url });
        } else {
            throw new Error(netlifyData.message || "Unknown Netlify Error");
        }
    } catch (error) { 
        io.emit('deploy-log', `\n❌ Deploy Failed: ${error.message}`);
        res.status(500).json({ error: error.message }); 
    }
});

// ==========================================
// 🐙 FULL GITHUB GITOPS ROUTE
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
            { name: repoName, private: false, description: "React Frontend generated by Mantu OS 🚀" },
            { headers: { 'Authorization': `token ${githubToken}` } }
        ).catch(e => {}); 

        const repoUrl = `https://${githubToken}@github.com/${username}/${repoName}.git`;
        io.emit('deploy-log', `\n⚙️ Pushing Enterprise Structure to GitHub...`);
        
        const gitCommands = `cd ${WORKSPACE_DIR} && rm -rf .git && git init && git config user.email "cto@mantu.ai" && git config user.name "Mantu Agent" && git add . && git commit -m "🚀 Automated React App by Mantu OS" && git branch -M main && git remote add origin ${repoUrl} && git push -u origin main --force`;

        exec(gitCommands, (err, stdout, stderr) => {
            if (err) {
                io.emit('deploy-log', `\n❌ Git Push Failed. Ensure token has 'repo' permissions.`);
                return res.status(500).json({ error: "Git push failed." });
            }
            io.emit('deploy-log', `\n🎉 Successfully pushed to GitHub!`);
            res.json({ success: true, message: "Pushed to GitHub successfully!", url: `https://github.com/${username}/${repoName}` });
        });
    } catch (error) { 
        io.emit('deploy-log', `\n❌ GitHub Error: ${error.message}`);
        res.status(500).json({ error: error.message }); 
    }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Mantu Enterprise Engine is running on port ${PORT}`));
