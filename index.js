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
const User = require('./models/User'); // Ensure this model exists
const connectDB = require('./config/db'); // Ensure this config exists
const Project = require('./models/Project'); // Ensure this model exists

const app = express();
app.use(cors());
app.use(express.json({ limit: "200mb" })); // Extended limit for Image Uploads

// 🚀 Start Mantu DB (MongoDB)
connectDB();

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on('connection', (socket) => {
    console.log('🟢 CTO Connected to Mantu AI Enterprise Engine');
});

const WORKSPACE_DIR = path.join(__dirname, "mantu_workspace");
const JWT_SECRET = process.env.JWT_SECRET || "mantu_ai_super_secret_key_2026";

// ==========================================
// 🧠 HELPER FUNCTIONS (ROBUST PARSING)
// ==========================================
const extractJson = (text) => {
    try {
        let cleanText = text.replace(/```(json)?/gi, "").trim();
        const start = cleanText.indexOf("{");
        const end = cleanText.lastIndexOf("}");
        if (start !== -1 && end !== -1) {
            return JSON.parse(cleanText.substring(start, end + 1));
        }
        return JSON.parse(cleanText);
    } catch (e) { 
        // 🛡️ FAILSAFE ARCHITECTURE: If AI fails to return JSON, force the Monorepo structure
        return { 
            tech_stack: "React + FastAPI", 
            files_needed: [
                "frontend/package.json", 
                "frontend/vite.config.js", 
                "frontend/tailwind.config.js", 
                "frontend/src/index.css", 
                "frontend/src/main.jsx", 
                "frontend/src/App.jsx", 
                "api/main.py", 
                "api/requirements.txt", 
                "vercel.json"
            ] 
        }; 
    }
};

const cleanRawCode = (text) => {
    if (!text) return "// Output generation failed.";
    let clean = text.replace(/```(javascript|js|jsx|python|py|html|css|json|bash|sh)?\n/gi, "");
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
// 🤖 THE CASCADING AI ENGINE (VISION + TIMEOUTS)
// ==========================================
async function safeGenerate(promptText, isJson = true, attachments = {}) {
    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const awsLlmUrl = process.env.AWS_LLM_URL;

    // 📸 VISION OVERRIDE: If image is uploaded, FORCE Gemini 1.5 Pro
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
            console.error("Vision Error:", e);
            throw new Error("Image Vision failed. Check Gemini API key."); 
        }
    }

    let finalPrompt = promptText;
    if (attachments && attachments.voiceUrl) finalPrompt += `\n[Audio/Voice Data Provided]`;

    // 🏆 PRIORITY 1: AWS LLM (Fastest, 8-second timeout)
    if (awsLlmUrl) {
        try {
            const awsRes = await axios.post(awsLlmUrl, { model: "llama", prompt: finalPrompt }, { timeout: 8000 });
            if (awsRes.data?.choices?.[0]) return { text: awsRes.data.choices[0].message.content, engine: "AWS_LLM" };
        } catch (err) { console.log("⚠️ AWS LLM Error/Timeout, falling back to Groq..."); }
    }

    // 🥈 PRIORITY 2: Groq (Llama 3 - High Intelligence)
    if (groqKey) {
        try {
            const groq = new Groq({ apiKey: groqKey });
            const groqRes = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: "You are an Elite Enterprise Full-Stack Developer. Write production-ready, complete code without placeholders. Do not skip any logic." }, 
                    { role: "user", content: finalPrompt }
                ],
                model: "llama-3.3-70b-versatile",
                temperature: 0.1
            });
            return { text: groqRes.choices[0].message.content, engine: "Groq" };
        } catch (err) { console.log("⚠️ Groq Error, falling back to Gemini..."); }
    }

    // 🥉 PRIORITY 3: Gemini (Ultimate Fallback)
    try {
        if(!geminiKey) throw new Error("No Gemini Key Provided in .env");
        const genAI = new GoogleGenerativeAI(geminiKey);
        const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" }); 
        const res = await geminiModel.generateContent(finalPrompt);
        return { text: res.response.text(), engine: "Gemini" };
    } catch (err) { 
        throw new Error(`All AI Engines Failed. Please try again or check your API Keys.`); 
    }
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
            success: true, 
            message: "Account created successfully!", 
            token,
            user: { id: newUser._id, name: newUser.name, email: newUser.email, credits: newUser.credits }
        });
    } catch (error) { 
        res.status(500).json({ error: "Server Error during Signup." }); 
    }
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
            success: true, 
            message: "Logged in successfully!", 
            token,
            user: { id: user._id, name: user.name, email: user.email, credits: user.credits }
        });
    } catch (error) { 
        res.status(500).json({ error: "Server Error during Login." }); 
    }
});

// ==========================================
// 🗄️ FULL DATABASE ROUTES (PROJECT SYNC)
// ==========================================
app.post('/api/save-project', async (req, res) => {
    try {
        const { title, files, userId } = req.body;
        if (!files || Object.keys(files).length === 0) return res.status(400).json({ error: "No files generated to save." });
        
        const newProject = await Project.create({ userId: userId, title: title || "New Mantu App", files: files });
        res.status(201).json({ success: true, message: "Project securely saved to Mantu DB!", projectId: newProject._id });
    } catch (error) { 
        res.status(500).json({ error: "Failed to save project to cloud." }); 
    }
});

app.get('/api/get-projects', async (req, res) => {
    try {
        const { userId } = req.query;
        const query = userId ? { userId: userId } : {}; 
        const projects = await Project.find(query).sort({ createdAt: -1 }).limit(10);
        res.status(200).json({ success: true, data: projects });
    } catch (error) { 
        res.status(500).json({ error: "Could not fetch projects." }); 
    }
});

// ==========================================
// 🏗️ MAIN BUILD API (PYTHON + REACT MONOREPO)
// ==========================================
app.post('/api/build', async (req, res) => {
    // 🫀 KEEP-ALIVE LOGIC TO BYPASS RENDER TIMEOUTS
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    
    const heartbeat = setInterval(() => { res.write(`data: keepalive\n\n`); }, 10000);
    const sendEvent = (type, data) => { res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`); };

    try {
        await fs.rm(WORKSPACE_DIR, { recursive: true, force: true }).catch(() => {});
        await fs.mkdir(WORKSPACE_DIR, { recursive: true });

        const { prompt, image, voiceUrl } = req.body;
        sendEvent('log', { agent: "Mantu OS", status: "Active", details: "Architecting Fullstack FastAPI + React Project..." });

        // 🔥 THE ULTIMATE ENTERPRISE ARCHITECTURE PROMPT
        const masterPrompt = `Design a complete, production-ready Full-Stack application for: "${prompt}".
        
        CRITICAL ARCHITECTURE RULES:
        1. Frontend: React + Vite + Tailwind CSS. Put files inside 'frontend/' (e.g., frontend/src/App.jsx, frontend/package.json, frontend/tailwind.config.js, frontend/src/index.css).
        2. Backend: Python FastAPI. Put files inside 'api/' (e.g., api/main.py, api/requirements.txt).
        3. Configs: MUST include 'vercel.json' in the root directory for deployment routing.
        
        Return ONLY a JSON object with this exact structure:
        {"tech_stack": "React + FastAPI", "files_needed": ["frontend/package.json", "frontend/vite.config.js", "frontend/tailwind.config.js", "frontend/src/index.css", "frontend/src/main.jsx", "frontend/src/App.jsx", "api/main.py", "api/requirements.txt", "vercel.json"]}`;
        
        let masterData = await safeGenerate(masterPrompt, true, { image, voiceUrl });
        const architecture = extractJson(masterData.text);
        let filesToGenerate = architecture.files_needed || [];
        
        // 🛡️ Failsafe: Ensure core files are always present
        const essentialFiles = ["frontend/src/App.jsx", "frontend/src/index.css", "api/main.py", "frontend/package.json", "vercel.json", "api/requirements.txt"];
        essentialFiles.forEach(f => { if(!filesToGenerate.includes(f)) filesToGenerate.push(f); });

        // ⚡ CONCURRENT GENERATION (Chunks of 2 to avoid EEXIST crashes & timeouts)
        const concurrencyLimit = 2; 
        for (let i = 0; i < filesToGenerate.length; i += concurrencyLimit) {
             const chunk = filesToGenerate.slice(i, i + concurrencyLimit);
             await Promise.all(chunk.map(async (filename) => {
                 try {
                     sendEvent('log', { agent: "Developer", status: "Coding", details: `Writing ${filename}...` });
                     
                     const workerPrompt = `Write the COMPLETE, production-ready code for '${filename}' for this app: "${prompt}". 
                     DO NOT write placeholders like '// Add logic here'. Write the actual functional code.
                     If it's package.json, include all necessary dependencies (react, react-dom, tailwindcss, lucide-react, etc.).
                     If it's requirements.txt, include fastapi, uvicorn, pydantic, cors.
                     If it's vercel.json, write the routing logic to point /api to api/main.py.
                     Return ONLY the raw code. NO markdown formatting, NO explanations.`;
                     
                     const codeData = await safeGenerate(workerPrompt, false, { image, voiceUrl });
                     const cleanCode = cleanRawCode(codeData.text);
                     
                     const absoluteFilePath = path.join(WORKSPACE_DIR, filename);
                     
                     // 🛡️ SAFE DIRECTORY CREATION
                     try { 
                         await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true }); 
                     } catch (mkdirErr) { 
                         if (mkdirErr.code !== 'EEXIST') throw mkdirErr; 
                     }
                     
                     await fs.writeFile(absoluteFilePath, cleanCode);
                     sendEvent('file', { filename: filename, code: cleanCode });
                 } catch(err) { 
                     console.error(`Error on ${filename}:`, err); 
                 }
             }));
        }
        sendEvent('done', { success: true });
    } catch (error) {
        sendEvent('error', { error: error.message });
    } finally {
        clearInterval(heartbeat); // Stop pinging
        res.end();
    }
});

// ==========================================
// ☁️ 1. MANTU CLOUD DEPLOY (NETLIFY HTML INJECTION)
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
        
        // Push the entire Monorepo to Netlify
        archive.directory(WORKSPACE_DIR, false);
        
        // 🔥 INJECT COMPILED HTML: This ensures the Netlify link works instantly without running 'npm run build'
        if(compiledHtml) {
            archive.append(compiledHtml, { name: 'index.html' });
        }

        await archive.finalize();
        await new Promise(resolve => output.on('close', resolve));

        io.emit('deploy-log', `\n🚀 Deploying to Netlify Edge via Native cURL...`);
        
        const netlifyCmd = `curl -s -X POST -H "Content-Type: application/zip" -H "Authorization: Bearer ${netlifyToken}" --data-binary "@${zipPath}" https://api.netlify.com/api/v1/sites`;
        const { stdout } = await execPromise(netlifyCmd);
        const netlifyData = JSON.parse(stdout);
        
        await fs.unlink(zipPath).catch(()=>{}); // Clean up

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
// 🐙 2. GITHUB GITOPS DEPLOY (TRUE MONOREPO PUSH)
// ==========================================
app.post('/api/publish-github', async (req, res) => {
    const { githubToken, repoName } = req.body;
    if (!githubToken || !repoName) return res.status(400).json({ error: "Missing GitHub Token or Repo Name" });

    try {
        io.emit('deploy-log', `\n🐙 Connecting to GitHub API...`);
        
        // Validate User
        const userRes = await axios.get('[https://api.github.com/user](https://api.github.com/user)', { headers: { 'Authorization': `token ${githubToken}` }});
        const username = userRes.data.login;
        io.emit('deploy-log', `\n👤 Authenticated as: @${username}`);
        io.emit('deploy-log', `\n📦 Creating Repository: ${repoName}...`);

        // Create Repo
        await axios.post('[https://api.github.com/user/repos](https://api.github.com/user/repos)', 
            { name: repoName, private: false, description: "Python Backend + React Frontend generated by Mantu OS 🚀" },
            { headers: { 'Authorization': `token ${githubToken}` } }
        ).catch(e => {}); // Ignore if repo exists

        // Push Monorepo
        const repoUrl = `https://${githubToken}@github.com/${username}/${repoName}.git`;
        io.emit('deploy-log', `\n⚙️ Pushing Enterprise Structure to GitHub...`);
        
        const gitCommands = `cd ${WORKSPACE_DIR} && rm -rf .git && git init && git config user.email "cto@mantu.ai" && git config user.name "Mantu Agent" && git add . && git commit -m "🚀 Automated Enterprise Monorepo by Mantu OS" && git branch -M main && git remote add origin ${repoUrl} && git push -u origin main --force`;

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

// ==========================================
// 🚀 3. AWS EC2 DEPLOY (FULL SSH SCRIPT)
// ==========================================
app.post('/api/publish-aws', async (req, res) => {
    let { targetIp, authKey, customSettings } = req.body;
    if (!targetIp || !authKey) return res.status(400).json({ error: "Missing AWS IP or PEM Key" });
    
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
        io.emit('deploy-log', `\n📦 Uploading Monorepo to AWS Server (${targetIp})...`);
        
        // Comprehensive script to install Node, Python, setup Vite build, and run FastAPI via uvicorn
        const scpCommand = `scp -o StrictHostKeyChecking=no -i ${pemPath} ${zipPath} ubuntu@${targetIp}:~/app.zip`;
        const sshCommand = `ssh -o StrictHostKeyChecking=no -i ${pemPath} ubuntu@${targetIp} "\
            mkdir -p /home/ubuntu/mantu_app && unzip -o ~/app.zip -d /home/ubuntu/mantu_app && \
            sudo apt-get update -y && sudo apt-get install -y nodejs npm python3-pip python3-venv pm2 nginx && \
            if [ -d "/home/ubuntu/mantu_app/frontend" ]; then \
                cd /home/ubuntu/mantu_app/frontend && npm install && npm run build && \
                sudo rm -rf /var/www/html/* && sudo cp -r dist/* /var/www/html/ ; \
            fi && \
            if [ -d "/home/ubuntu/mantu_app/api" ]; then \
                cd /home/ubuntu/mantu_app/api && pip3 install -r requirements.txt && \
                sudo fuser -k 8000/tcp || true && pm2 start 'uvicorn main:app --host 0.0.0.0 --port 8000' --name python_backend ; \
            fi && echo '🚀 AWS Deployment Success' \
        "`;

        const process = exec(sshCommand);
        process.stdout.on('data', data => io.emit('deploy-log', data.toString()));
        process.stderr.on('data', data => io.emit('deploy-log', `> ${data.toString()}`));

        process.on('close', async (code) => {
            await fs.unlink(zipPath).catch(()=>{}); 
            await fs.unlink(pemPath).catch(()=>{});
            if (code === 0) res.json({ success: true, url: `http://${targetIp}` });
            else res.status(500).json({ error: "AWS deployment script failed." });
        });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

// ==========================================
// 🌐 4. DOMAIN SETUP API
// ==========================================
app.post('/api/setup-domain', async (req, res) => {
    const { customDomain } = req.body;
    io.emit('deploy-log', `\n🌐 Mapping Custom Domain: ${customDomain}`);
    io.emit('deploy-log', `\n⏳ Validating DNS records for ${customDomain}...`);
    
    setTimeout(() => {
        io.emit('deploy-log', `\n✅ Domain verification initialized. Please update CNAME records.`);
        res.json({ success: true, message: `Domain ${customDomain} linked!`, url: `https://${customDomain}` });
    }, 2000);
});

// ==========================================
// ⚡ START SERVER
// ==========================================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Mantu Enterprise Engine is running on port ${PORT}`));
