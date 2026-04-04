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
    console.log('🟢 CTO Connected to Mantu Dynamic Super Swarm');
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
        return { 
            tech_stack: "React + Tailwind", 
            files_needed: ["package.json", "vite.config.js", "tailwind.config.js", "index.html", "src/main.jsx", "src/index.css", "src/App.jsx", "src/components/MainView.jsx"] 
        }; 
    }
};

const cleanRawCode = (text) => {
    if (!text) return "// Output generation failed.";
    let clean = text.trim();
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
// 🤖 THE STRICT AI SEQUENCE 
// ==========================================
async function safeGenerate(promptText, isJson = true, attachments = {}) {
    const awsLlmUrl = process.env.AWS_LLM_URL;
    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    let errorLogs = []; 

    const systemPrompt = "You are a core module of the Mantu Multi-Agent Enterprise Swarm. You write flawless, modern React (v18+) code in PURE JAVASCRIPT (JSX). NEVER use TypeScript. NEVER output partial code. ALWAYS output the entire file content perfectly closed.";

    if (attachments && attachments.image) {
        try {
            if(!geminiKey) throw new Error("Gemini Key required");
            const genAI = new GoogleGenerativeAI(geminiKey);
            const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-pro", systemInstruction: systemPrompt });
            const parsed = parseBase64(attachments.image);
            const res = await geminiModel.generateContent([promptText, { inlineData: { data: parsed.data, mimeType: parsed.mimeType } }]);
            return { text: res.response.text(), engine: "Gemini Vision" };
        } catch(e) {}
    }

    if (awsLlmUrl) {
        try {
            let finalAwsUrl = awsLlmUrl.trim();
            if (!finalAwsUrl.endsWith('/api/generate')) finalAwsUrl = finalAwsUrl.replace(/\/$/, '') + '/api/generate';
            console.log(`➡️ Trying AWS GPU...`);
            const awsRes = await axios.post(finalAwsUrl, { model: "llama3", system: systemPrompt, prompt: promptText, stream: false }, { timeout: 60000 }); 
            if (awsRes.data && awsRes.data.response) return { text: awsRes.data.response, engine: "AWS_Ollama" };
        } catch (err) { errorLogs.push(`AWS: ${err.message}`); }
    }

    if (groqKey) {
        try {
            console.log("➡️ Trying Groq...");
            const groq = new Groq({ apiKey: groqKey });
            const groqRes = await groq.chat.completions.create({
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: promptText }],
                model: "llama-3.3-70b-versatile", temperature: 0.1, max_tokens: 6000
            });
            if (groqRes.choices?.[0]?.message?.content) return { text: groqRes.choices[0].message.content, engine: "Groq" };
        } catch (err) { errorLogs.push(`Groq: ${err.message}`); }
    }

    if (geminiKey) {
        try {
            console.log("➡️ Trying Gemini...");
            const genAI = new GoogleGenerativeAI(geminiKey);
            const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-pro", systemInstruction: systemPrompt }); 
            const res = await geminiModel.generateContent(promptText);
            return { text: res.response.text(), engine: "Gemini" };
        } catch (err) { errorLogs.push(`Gemini: ${err.message}`); }
    }

    throw new Error(`All Engines Failed. Details: ${errorLogs.join(' | ')}`);
}

// ==========================================
// 🔐 AUTH & DATABASE
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
        res.status(201).json({ success: true, message: "Account created!", token, user: { id: newUser._id, name: newUser.name, email: newUser.email, credits: newUser.credits } });
    } catch (error) { res.status(500).json({ error: "Server Error." }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: "User not found!" });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: "Invalid Credentials." });
        const token = jwt.sign({ id: user._id, plan: user.plan }, JWT_SECRET, { expiresIn: '7d' });
        res.status(200).json({ success: true, message: "Logged in!", token, user: { id: user._id, name: user.name, email: user.email, credits: user.credits } });
    } catch (error) { res.status(500).json({ error: "Server Error." }); }
});

app.post('/api/save-project', async (req, res) => {
    try {
        const { title, files, userId } = req.body;
        if (!files || Object.keys(files).length === 0) return res.status(400).json({ error: "No files generated to save." });
        const newProject = await Project.create({ userId: userId, title: title || "New Mantu App", files: files });
        res.status(201).json({ success: true, message: "Project saved!", projectId: newProject._id });
    } catch (error) { res.status(500).json({ error: "Failed to save." }); }
});

app.get('/api/get-projects', async (req, res) => {
    try {
        const { userId } = req.query;
        const projects = await Project.find(userId ? { userId: userId } : {}).sort({ createdAt: -1 }).limit(10);
        res.status(200).json({ success: true, data: projects });
    } catch (error) { res.status(500).json({ error: "Fetch failed." }); }
});

// ==========================================
// 🏗️ MAIN BUILD API (DYNAMIC SWARM UPDATE)
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
        let uiContext = "Use modern premium UI with Tailwind CSS.";
        let copyContext = "Use highly realistic professional marketing copy and dummy data.";

        if (isFollowUp) {
            sendEvent('log', { agent: "Mantu OS", status: "Active", details: "Processing Follow-up Request..." });
            filesToGenerate = Object.keys(existingFiles);
        } else {
            sendEvent('log', { agent: "Mantu OS", status: "Initializing Swarm", details: "Waking up Dynamic Virtual IT Company..." });

            try {
                sendEvent('log', { agent: "Copywriter Agent ✍️", status: "Drafting", details: "Analyzing prompt for real-world text context..." });
                const copyRes = await safeGenerate(`You are a Copywriter. Analyze the prompt: "${prompt}". Create highly engaging, industry-specific Headings, subtext, and realistic dummy data items. Output ONLY pure text.`, false);
                copyContext = copyRes.text;
            } catch(e) {}

            try {
                // 🔥 THE DYNAMIC UI/UX ARCHITECT
                sendEvent('log', { agent: "UI/UX Architect 🎨", status: "Designing", details: "Extracting Vibe and Color Palette..." });
                const uiPrompt = `Analyze the user's prompt: "${prompt}". Determine the exact VIBE, INDUSTRY, and MOOD. Create a highly specific, unique Tailwind CSS design system. 
                If it's crypto/hacker, make it dark/neon. If it's a bakery/kids, make it warm/pastel. 
                Specify exact color palettes (e.g., text-emerald-400, bg-zinc-950), font recommendations, border-radius, and shadow styles. Output ONLY a concise design guide text.`;
                const uiRes = await safeGenerate(uiPrompt, false);
                uiContext = uiRes.text;
            } catch(e) {}

            sendEvent('log', { agent: "Product Manager 👔", status: "Planning", details: "Architecting Smart File Structure..." });
            
            // 🔥 THE DYNAMIC PRODUCT MANAGER
            const masterPrompt = `Analyze the user's prompt: "${prompt}". Determine if the user wants a SINGLE COMPONENT (like a specific widget/card) or a FULL WEBSITE.
            CRITICAL RULES:
            1. Return ONLY a JSON object representing the file structure.
            2. If it's a FULL WEBSITE, explicitly include multi-page structure: HomePage, AboutPage, ContactPage, Navbar, Footer.
            3. If it's just a SINGLE COMPONENT, ONLY include that component and necessary wrapper files. Do not overcomplicate.
            4. Core files ALWAYS needed: package.json, vite.config.js, tailwind.config.js, index.html, src/main.jsx, src/index.css, src/App.jsx.
            5. 🚫 STRICTLY FLAT COMPONENTS: Keep ALL components flat inside 'src/components/'. DO NOT create subdirectories like 'src/pages/'.
            6. 🚫 MEDIA BAN: NO .png, .ico, or .jpg files.
            FORMAT: {"tech_stack": "React + Tailwind", "files_needed": ["package.json", "src/App.jsx", "src/components/YourComponent.jsx"]}`;
            
            let masterData = await safeGenerate(masterPrompt, true, { image, voiceUrl });
            const architecture = extractJson(masterData.text);
            let rawFiles = architecture.files_needed || [];
            
            // 🔥 THE CTO ABSOLUTE FILE PATH SANITIZER 🔥
            let flattenedFiles = [];
            rawFiles.forEach(f => {
                if (f.match(/\.(png|jpe?g|gif|svg|ico)$/i)) return; // Block media

                if (f.endsWith('.jsx') || f.endsWith('.js') || f.endsWith('.tsx')) {
                    const fileName = path.basename(f);
                    if (['vite.config.js', 'tailwind.config.js', 'postcss.config.js'].includes(fileName)) {
                        flattenedFiles.push(fileName);
                    } else if (['main.jsx', 'App.jsx', 'index.js', 'index.jsx'].includes(fileName)) {
                        flattenedFiles.push(`src/${fileName}`);
                    } else {
                        flattenedFiles.push(`src/components/${fileName}`); // Force flat components
                    }
                } else {
                    flattenedFiles.push(f);
                }
            });
            
            filesToGenerate = [...new Set(flattenedFiles)]; 
            
            // Ensure strictly essential config files exist
            const essentialFiles = ["package.json", "vite.config.js", "tailwind.config.js", "index.html", "src/main.jsx", "src/index.css", "src/App.jsx"];
            essentialFiles.forEach(f => { if(!filesToGenerate.includes(f)) filesToGenerate.unshift(f); });
        }

        for (let i = 0; i < filesToGenerate.length; i++) {
             const filename = filesToGenerate[i];
             try {
                 sendEvent('log', { agent: "Developer Agent 👨‍💻", status: "Coding", details: `Generating ${filename}...` });
                 
                 const workerPrompt = `Write the COMPLETE, flawless code for '${filename}' for this project: "${prompt}". 
                 Project File List: [ ${filesToGenerate.join(', ')} ]
                 
                 --- DYNAMIC SWARM CONTEXT ---
                 🎨 DESIGN VIBE: ${uiContext}
                 ✍️ COPYWRITING/DATA: ${copyContext}
                 
                 💎 STRICT RULES (VIOLATION CAUSES FATAL CRASH):
                 1. ADAPT TO THE VIBE: Strictly follow the colors, borders, and shadows specified in the DESIGN VIBE.
                 2. 🚫 NO UNQUOTED CURRENCY: In JS objects, wrap currency in quotes (e.g. price: "$45000").
                 3. 🚫 NO INLINE PAGES IN App.jsx: App.jsx is ONLY for <Routes>. Do not redefine component functions inside App.jsx.
                 4. 🚫 NO NAMESPACES: Never use <svg:path> or xmlns:xlink.
                 5. 🚫 NO TYPESCRIPT ALLOWED: You MUST write PURE JavaScript (JSX).
                 6. REACT ROUTER v6 ONLY: Use <BrowserRouter> and <Routes> if routing is needed.
                 7. 🚫 GHOST COMPONENT BAN: IF YOU NEED A COMPONENT BUT IT IS NOT IN THE 'Project File List', BUILD IT INLINE. DO NOT IMPORT IT!
                 8. COMPLETE FILE: Output the ENTIRE file perfectly closed.
                 
                 Write the full code for ${filename} now:`;
                 
                 const codeData = await safeGenerate(workerPrompt, false, { image, voiceUrl });
                 let cleanCode = cleanRawCode(codeData.text);
                 
                 // 🛡️ AGENT: QA BUG-FIXER
                 const badPatterns = [
                     { regex: /:\s*\$[0-9\,\.]+/g, msg: "FATAL: Unquoted currency symbol in JS object. Wrap it in quotes like price: '$100'." },
                     { regex: /<[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+/g, msg: "Remove namespace tags like <svg:path>." },
                     { regex: /\s+[a-zA-Z]+:[a-zA-Z]+=/g, msg: "Remove namespace attributes like xmlns:xlink." },
                     { regex: /<Helmet>/g, msg: "Remove 'Helmet' component." },
                     { regex: /\{\s*\.\.\.\s*\}/g, msg: "Invalid lazy syntax '{ ... }'." },
                     { regex: /\/\*[\s\S]*?(add|insert|your)[\s\S]*?\*\//gi, msg: "Lazy block comment found. Write real code." },
                     { regex: /\binterface\s+[A-Za-z0-9_]+\s*\{/g, msg: "TypeScript 'interface' detected. Rewrite in JSX." },
                     { regex: /\btype\s+[A-Za-z0-9_]+\s*=/g, msg: "TypeScript 'type' detected. Rewrite in JSX." }
                 ];

                 let detectedBugs = [];
                 badPatterns.forEach(pattern => { if (pattern.regex.test(cleanCode)) detectedBugs.push(pattern.msg); });

                 if (filename.includes('App.jsx')) {
                     if (cleanCode.match(/function\s+(HomePage|AboutPage|ContactPage|DashboardPage)\s*\(/)) {
                         detectedBugs.push("FATAL: You redefined a page component inside App.jsx! Only set up the <Routes>.");
                     }
                 }

                 if (filename.endsWith('.jsx') || filename.endsWith('.tsx') || filename.endsWith('.js')) {
                     const openBraces = (cleanCode.match(/\{/g) || []).length;
                     const closeBraces = (cleanCode.match(/\}/g) || []).length;
                     if (openBraces !== closeBraces) {
                         detectedBugs.push("Mismatched braces {}! Generate FULL code and close tags.");
                     }
                     // Ensure React components are actually exported
                     if (!cleanCode.includes('export ') && !filename.includes('vite.config') && !filename.includes('tailwind.config')) {
                         detectedBugs.push("Missing 'export'. Component is incomplete.");
                     }
                 }

                 if (detectedBugs.length > 0) {
                     sendEvent('log', { agent: "QA Agent 🛡️", status: "Fixing Bugs", details: `Errors detected in ${filename}. Auto-healing...` });
                     const fixPrompt = `You generated bad code for '${filename}'. FIX THESE ERRORS: \n- ${detectedBugs.join('\n- ')}\n\nBAD CODE:\n${cleanCode}\n\nFIX ALL ERRORS. Output ONLY fully corrected, complete pure JavaScript (JSX) code. NO TYPESCRIPT.`;
                     const fixedData = await safeGenerate(fixPrompt, false);
                     cleanCode = cleanRawCode(fixedData.text);
                 }

                 const absoluteFilePath = path.join(WORKSPACE_DIR, filename);
                 try { await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true }); } 
                 catch (mkdirErr) { if (mkdirErr.code !== 'EEXIST') throw mkdirErr; }
                 
                 await fs.writeFile(absoluteFilePath, cleanCode);
                 sendEvent('file', { filename: filename, code: cleanCode, engine: codeData.engine });
                 
                 await new Promise(r => setTimeout(r, 1500));
             } catch(err) { 
                 console.error(`Error generating ${filename}:`, err);
                 sendEvent('log', { agent: "System", status: "Error", details: `Failed ${filename}: ${err.message}` });
             }
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
// ☁️ FULL DEPLOY ROUTE & GITHUB
// ==========================================
app.post('/api/publish-cloud', async (req, res) => {
    try {
        const { compiledHtml } = req.body; 
        const netlifyToken = process.env.NETLIFY_TOKEN ? process.env.NETLIFY_TOKEN.replace(/[\r\n"' ]/g, '') : null; 
        if (!netlifyToken) return res.status(400).json({ error: "Netlify Token Missing in .env" });

        const zipPath = path.join(__dirname, `mantu_frontend_${Date.now()}.zip`);
        const output = fsSync.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(output);
        archive.directory(WORKSPACE_DIR, false);
        if(compiledHtml) archive.append(compiledHtml, { name: 'index.html' });

        await archive.finalize();
        await new Promise(resolve => output.on('close', resolve));

        const netlifyCmd = `curl -s -X POST -H "Content-Type: application/zip" -H "Authorization: Bearer ${netlifyToken}" --data-binary "@${zipPath}" https://api.netlify.com/api/v1/sites`;
        const { stdout } = await execPromise(netlifyCmd);
        const netlifyData = JSON.parse(stdout);
        
        await fs.unlink(zipPath).catch(()=>{}); 

        if (netlifyData.url) res.json({ success: true, url: netlifyData.ssl_url || netlifyData.url });
        else throw new Error(netlifyData.message || "Unknown Netlify Error");
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/publish-github', async (req, res) => {
    const { githubToken, repoName } = req.body;
    if (!githubToken || !repoName) return res.status(400).json({ error: "Missing GitHub Token or Repo Name" });

    try {
        const userRes = await axios.get('[https://api.github.com/user](https://api.github.com/user)', { headers: { 'Authorization': `token ${githubToken}` }});
        const username = userRes.data.login;
        await axios.post('[https://api.github.com/user/repos](https://api.github.com/user/repos)', { name: repoName, private: false }, { headers: { 'Authorization': `token ${githubToken}` } }).catch(e => {}); 
        const repoUrl = `https://${githubToken}@github.com/${username}/${repoName}.git`;
        
        const gitCommands = `cd ${WORKSPACE_DIR} && rm -rf .git && git init && git config user.email "cto@mantu.ai" && git config user.name "Mantu Agent" && git add . && git commit -m "🚀 Automated App by Mantu OS" && git branch -M main && git remote add origin ${repoUrl} && git push -u origin main --force`;

        exec(gitCommands, (err) => {
            if (err) return res.status(500).json({ error: "Git push failed." });
            res.json({ success: true, url: `https://github.com/${username}/${repoName}` });
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Mantu Enterprise Engine is running on port ${PORT}`));
