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

// Limit badha di hai taaki Frontend se heavy Images aur Voice data easily aa sake
app.use(express.json({ limit: '100mb' })); 

const WORKSPACE_DIR = path.join(__dirname, 'mantu_workspace');

// System Folder Setup
if (!fsSync.existsSync(WORKSPACE_DIR)){
    fsSync.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

// 🛠️ HELPER FUNCTIONS
const cleanRawCode = (text) => {
    if (!text) return "";
    const match = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
    if (match && match[1]) return match[1].trim();
    return text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '').trim();
};

const extractJson = (text) => {
    try {
        let clean = text.replace(/```(json)?/gi, '').replace(/```/gi, '').trim();
        const start = clean.indexOf('{');
        const end = clean.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
            clean = clean.substring(start, end + 1);
        }
        return JSON.parse(clean);
    } catch (e) {
        // Fallback architecture if AI fails to return strict JSON
        return { tech_stack: "HTML/JS", files_needed: ["index.html", "styles.css", "App.js"] };
    }
};

const parseBase64 = (dataUrl) => {
    if (!dataUrl) return null;
    const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return null;
    return { mimeType: matches[1], data: matches[2] };
};

// 🤖 1. CORE AI BUILD ENGINE (Handles Text, Images, and Voice)
app.post('/api/build', async (req, res) => {
    // Setup Server-Sent Events (SSE) for Real-Time UI Updates
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    const sendEvent = (type, data) => {
        res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    try {
        const { prompt, image, voice, voiceUrl, customSettings } = req.body;
        const groqKey = customSettings?.groqKey || process.env.GROQ_API_KEY;
        const geminiKey = process.env.GEMINI_API_KEY;

        if (!prompt) throw new Error("Prompt is required");

        sendEvent('log', { agent: "System", details: "Initializing Mantu AI Engine..." });

        let finalPrompt = prompt;
        if (voiceUrl) finalPrompt += `\n[User referenced this Audio URL: ${voiceUrl}]`;

        // Check if we need Vision/Audio Multimodal capabilities
        let isMultimodal = (image || voice);
        let architectResponseText = "";

        // ================= PHASE 1: ARCHITECTURE PLANNING =================
        sendEvent('log', { agent: "Architect", details: "Designing project architecture..." });

        if (isMultimodal) {
            if (!geminiKey) throw new Error("Gemini API Key is required for Image/Voice processing.");
            const genAI = new GoogleGenerativeAI(geminiKey);
            const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
            
            let parts = [`You are an elite CTO. Design the architecture for this request: "${finalPrompt}". Return ONLY a JSON object with {"tech_stack": "React/Node etc", "files_needed": ["index.html", "App.jsx", "package.json"]}. No explanations.`];
            
            if (image) {
                const imgData = parseBase64(image);
                if (imgData) parts.push({ inlineData: { data: imgData.data, mimeType: imgData.mimeType } });
            }
            if (voice) {
                const voiceData = parseBase64(voice);
                if (voiceData) parts.push({ inlineData: { data: voiceData.data, mimeType: voiceData.mimeType } });
            }

            const result = await model.generateContent(parts);
            architectResponseText = result.response.text();
        } else {
            if (!groqKey) throw new Error("Groq API Key is required for fast text generation. Check Settings ⚙️");
            const groq = new Groq({ apiKey: groqKey });
            const completion = await groq.chat.completions.create({
                messages: [
                    { role: 'system', content: 'You are an elite CTO. Output ONLY valid JSON with keys: tech_stack, files_needed (array of filenames).' },
                    { role: 'user', content: `Design architecture for: ${finalPrompt}` }
                ],
                model: 'llama-3.3-70b-versatile',
                temperature: 0.2,
                response_format: { type: 'json_object' }
            });
            architectResponseText = completion.choices[0].message.content;
        }

        const architecture = extractJson(architectResponseText);
        const filesToGenerate = architecture.files_needed || ["index.html"];
        sendEvent('log', { agent: "Architect", details: `Project requires ${filesToGenerate.length} files. Tech Stack: ${architecture.tech_stack}` });

        // ================= PHASE 2: CODE GENERATION LOOP =================
        for (const filename of filesToGenerate) {
            sendEvent('log', { agent: "Developer", details: `Writing code for ${filename}...` });
            
            let fileCode = "";
            const filePrompt = `You are a Senior Full Stack Developer. Write the COMPLETE, production-ready code for the file: "${filename}" based on this project idea: "${finalPrompt}". Tech stack: ${architecture.tech_stack}. \n\nCRITICAL: Output ONLY the raw code for this file. Do not include markdown blocks like \`\`\`javascript. Do not add explanations. Just the code.`;

            if (isMultimodal) {
                const genAI = new GoogleGenerativeAI(geminiKey);
                const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
                let parts = [filePrompt];
                if (image) {
                    const imgData = parseBase64(image);
                    if (imgData) parts.push({ inlineData: { data: imgData.data, mimeType: imgData.mimeType } });
                }
                const result = await model.generateContent(parts);
                fileCode = cleanRawCode(result.response.text());
            } else {
                const groq = new Groq({ apiKey: groqKey });
                const completion = await groq.chat.completions.create({
                    messages: [
                        { role: 'system', content: 'You are an expert developer. Output strictly raw code. No markdown formatting.' },
                        { role: 'user', content: filePrompt }
                    ],
                    model: 'llama-3.3-70b-versatile',
                    temperature: 0.5
                });
                fileCode = cleanRawCode(completion.choices[0].message.content);
            }

            // Save File Locally
            const absoluteFilePath = path.join(WORKSPACE_DIR, filename);
            await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true });
            await fs.writeFile(absoluteFilePath, fileCode);

            // Stream File to Frontend Workspace
            sendEvent('file', { filename, code: fileCode });
            sendEvent('log', { agent: "Developer", details: `✅ ${filename} completed.` });
        }

        sendEvent('log', { agent: "System", details: "All files generated successfully!" });
        sendEvent('done', { success: true });
        res.end();

    } catch (error) {
        console.error("Build API Error:", error);
        sendEvent('error', { error: error.message });
        res.end();
    }
});

// 🌩️ 2. DIRECT AWS EC2 DEPLOY API
app.post('/api/publish-aws', async (req, res) => {
    const { files, targetIp, authKey } = req.body;

    if (!targetIp || !authKey) {
        return res.json({ error: "AWS Server IP and .pem key are required!" });
    }

    try {
        const timestamp = Date.now();
        const zipName = `mantu_aws_${timestamp}.zip`;
        const zipPath = path.join(__dirname, zipName);
        const pemName = `key_${timestamp}.pem`;
        const pemPath = path.join(__dirname, pemName);

        // Step 1: Zip the frontend code
        const output = fsSync.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        archive.pipe(output);
        for (const [filename, content] of Object.entries(files || {})) {
            archive.append(content, { name: filename });
        }
        await archive.finalize();

        await new Promise(resolve => output.on('close', resolve)); // Ensure zip is fully written

        // Step 2: Format & Save PEM Key securely (AWS strictly needs chmod 400)
        // Replaces stringified newlines with actual newlines
        const formattedKey = authKey.replace(/\\n/g, '\n'); 
        await fs.writeFile(pemPath, formattedKey, { mode: 0o400 });

        // Step 3: Run AWS Linux Commands (SCP Upload -> SSH Unzip & Install)
        const scpCommand = `scp -o StrictHostKeyChecking=no -i ${pemPath} ${zipPath} ubuntu@${targetIp}:/tmp/mantu_app.zip`;
        const sshCommand = `ssh -o StrictHostKeyChecking=no -i ${pemPath} ubuntu@${targetIp} "mkdir -p ~/mantu_app && unzip -o /tmp/mantu_app.zip -d ~/mantu_app && cd ~/mantu_app && (npm install || true) && (npm run build || true)"`;

        await execPromise(scpCommand);
        const { stdout } = await execPromise(sshCommand);

        // Step 4: Delete keys from backend for security
        fsSync.unlinkSync(zipPath);
        fsSync.unlinkSync(pemPath);

        res.json({ success: true, url: `http://${targetIp}`, log: stdout });
    } catch (error) {
        console.error("AWS Deploy Error:", error);
        res.json({ error: `AWS Deployment Failed. Error: ${error.message}` });
    }
});

// ☁️ 3. MANTU CLOUD / NETLIFY DEPLOY API
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
            const response = await fetch("https://api.netlify.com/api/v1/sites", {
                method: "POST", 
                headers: { "Authorization": `Bearer ${netlifyToken}`, "Content-Type": "application/zip" }, 
                body: zipData
            });
            const siteData = await response.json();
            fsSync.unlinkSync(zipPath);
            
            if (response.ok) res.json({ success: true, url: siteData.ssl_url || siteData.url });
            else res.json({ error: `Cloud Error: ${siteData.message}` });
        } catch (err) { res.json({ error: `Deploy Crash: ${err.message}` }); }
    });

    archive.on('error', (err) => res.json({ error: `ZIP Error: ${err.message}` }));
    archive.pipe(output);
    for (const [filename, content] of Object.entries(files || {})) archive.append(content, { name: filename });
    archive.finalize();
});

// 💻 4. RUN SANDBOX API
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

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Mantu Backend completely operational on Port ${PORT}`));
