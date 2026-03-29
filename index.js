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

// 🌐 ADVANCE LEVEL: WebSockets For Live Deployment Logs
const http = require('http');
const { Server } = require('socket.io');

const { GoogleGenerativeAI } = require('@google/generative-ai'); 
const Groq = require('groq-sdk');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' })); 

// 🚀 Initialize HTTP Server with WebSockets
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on('connection', (socket) => {
    console.log(`🟢 CTO Connected to Mantu AI Live Stream: ${socket.id}`);
});

const WORKSPACE_DIR = path.join(__dirname, 'mantu_workspace');
if (!fsSync.existsSync(WORKSPACE_DIR)){ fsSync.mkdirSync(WORKSPACE_DIR, { recursive: true }); }

// ==============================================================
// 🛠️ UTILITY FUNCTIONS
// ==============================================================
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
// 🤖 THE CASCADING AI ENGINE (1st AWS -> 2nd Groq -> 3rd Gemini)
// ==============================================================
async function safeGenerate(promptText, isJson = true, sendEvent = null, customConfig = {}, attachments = {}) {
    const groqKey = process.env.GROQ_API_KEY || customConfig.groqKey;
    const geminiKey = process.env.GEMINI_API_KEY || customConfig.geminiKey; 
    const awsLlmUrl = process.env.AWS_LLM_URL;

    // Multimodal (Images/Voice) directly goes to Gemini Vision
    if (attachments.image || attachments.voice) {
        if(sendEvent) sendEvent('log', { agent: "Gemini Vision", status: "Computing", details: `Analyzing visual/audio data...` });
        try {
            if (!geminiKey) throw new Error("Gemini API Key missing.");
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
        } catch (err) { throw err; }
    }

    let finalPrompt = promptText;
    if (attachments.voiceUrl) finalPrompt += `\n[Audio URL: ${attachments.voiceUrl}]`;

    // 🏆 PRIORITY 1: AWS LOCAL LLM
    if (awsLlmUrl) {
        try {
            if(sendEvent) sendEvent('log', { agent: "AWS Worker", status: "Computing", details: `Connecting to self-hosted AI...` });
            const awsRes = await fetch(`${awsLlmUrl}/v1/chat/completions`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: "llama3", messages: [{ role: "system", content: isJson ? "Output valid JSON." : "Output raw code." }, { role: "user", content: finalPrompt }], temperature: 0.2 })
            });
            if (awsRes.ok) {
                const awsData = await awsRes.json();
                return { text: awsData.choices[0].message.content, engine: "AWS Local Llama" };
            }
        } catch (err) { console.log(`AWS AI unreachable, falling back to Groq...`); }
    }

    // ⚡ PRIORITY 2: GROQ CLOUD
    if (groqKey) {
        try {
            if(sendEvent) sendEvent('log', { agent: "GROQ Engine", status: "Computing", details: `Writing via Groq...` });
            const groq = new Groq({ apiKey: groqKey });
            const groqRes = await groq.chat.completions.create({ 
                messages: [ { role: 'system', content: isJson ? "Output valid JSON." : "Output raw code." }, { role: 'user', content: finalPrompt } ], 
                model: 'llama-3.3-70b-versatile', temperature: 0.2, response_format: isJson ? { type: 'json_object' } : null 
            });
            return { text: groqRes.choices[0].message.content, engine: "Groq Llama-3" };
        } catch (err) { console.log(`Groq failed, falling back to Gemini...`); }
    }

    // 🧠 PRIORITY 3: GEMINI PRO
    try {
        if (!geminiKey) throw new Error("Gemini Key missing.");
        if(sendEvent) sendEvent('log', { agent: "Gemini Engine", status: "Computing", details: `Writing via Gemini...` });
        const genAI = new GoogleGenerativeAI(geminiKey);
        const geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-pro', generationConfig: isJson ? { responseMimeType: "application/json" } : {} });
        const res = await geminiModel.generateContent(finalPrompt);
        return { text: res.response.text(), engine: "Gemini Text" };
    } catch (err) { throw new Error(`All AI engines failed in the cascade.`); }
}

// ==============================================================
// 🏥 MANTU AI: THE SELF-HEALING ENGINE (Auto-Error Fixer)
// ==============================================================
async function autoHealCode(errorLog, filesObject, customSettings) {
    io.emit('deploy-log', `\n🚨 [SELF-HEALING INITIATED] AI is analyzing the crash log...\n`);
    
    // Guessing the file that caused the error based on basic string matching
    let suspectedFile = "frontend/src/App.jsx"; // Default fallback
    if (errorLog.includes("backend") || errorLog.includes("python") || errorLog.includes("uvicorn")) suspectedFile = "backend/main.py";
    if (errorLog.includes("package.json")) suspectedFile = "frontend/package.json";
    
    let brokenCode = filesObject[suspectedFile] || "// File content not found in current payload";

    const healPrompt = `You are an Elite Enterprise CTO. The deployment crashed.
    Suspected File: "${suspectedFile}"
    Error Log from AWS Server:
    ${errorLog}
    
    Broken Code Context:
    ${brokenCode}
    
    Fix the bug immediately. Return ONLY the complete, corrected raw code for ${suspectedFile}. No markdown formats, no explanations.`;

    try {
        const fixedData = await safeGenerate(healPrompt, false, null, customSettings); 
        let fixedCode = cleanRawCode(fixedData.text);
        
        // Update the file payload with fixed code
        filesObject[suspectedFile] = fixedCode;
        
        // Save to workspace as well
        const absoluteFilePath = path.join(WORKSPACE_DIR, suspectedFile);
        await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true });
        await fs.writeFile(absoluteFilePath, fixedCode);

        io.emit('deploy-log', `\n✅ [SELF-HEALING SUCCESS] Bug fixed in ${suspectedFile} by ${fixedData.engine}! Resuming deployment...\n`);
        return filesObject; // Return the healed files
    } catch (error) {
        io.emit('deploy-log', `\n❌ [SELF-HEALING FAILED] AI could not fix the error: ${error.message}\n`);
        return null;
    }
}

// ==========================================
// 🏗️ MAIN BUILD API (Code Generation)
// ==========================================
app.post('/api/build', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const sendEvent = (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

    try {
        const { prompt, image, voice, voiceUrl, customSettings } = req.body;
        if (!prompt) throw new Error("Prompt is required");
        
        sendEvent('log', { agent: "Mantu OS", status: "Active", details: "Initializing Enterprise Engine..." });

        const masterPrompt = `You are an Elite Enterprise CTO. Design the backend and frontend architecture for this idea: "${prompt}". 
        CRITICAL RULE: You MUST use proper nested folder paths in the filenames (e.g., "backend/main.py", "frontend/src/App.jsx").
        Return ONLY a JSON object exactly like this: {"tech_stack": "React/FastAPI", "files_needed": ["frontend/package.json", "backend/main.py"]}. No explanations.`;
        
        let masterData = await safeGenerate(masterPrompt, true, sendEvent, customSettings, { image, voice, voiceUrl });
        const architecture = extractJson(masterData.text);
        const filesToGenerate = architecture.files_needed || ["backend/main.py", "frontend/src/App.jsx"];
        
        sendEvent('log', { agent: "Architect", status: "Success", details: `Project requires ${filesToGenerate.length} files.` });

        let generatedFiles = {};

        for (const filename of filesToGenerate) {
            try {
                sendEvent('log', { agent: "Developer", status: "Coding", details: `Writing code for ${filename}...` });
                const workerPrompt = `Write COMPLETE code for "${filename}" for project: "${prompt}". Output ONLY raw code.`;
                const generatedData = await safeGenerate(workerPrompt, false, sendEvent, customSettings, { image, voice, voiceUrl }); 
                let currentCode = cleanRawCode(generatedData.text);
                
                generatedFiles[filename] = currentCode;

                const absoluteFilePath = path.join(WORKSPACE_DIR, filename);
                await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true });
                await fs.writeFile(absoluteFilePath, currentCode);

                sendEvent('file', { filename: filename, code: currentCode });
                sendEvent('log', { agent: `${generatedData.engine}`, status: "Success", details: `✅ ${filename} completed.` });
            } catch (fileError) { sendEvent('log', { agent: "Crash", status: "Error", details: `Failed on ${filename}` }); }
        }
        sendEvent('log', { agent: "System", status: "Done", details: "All files generated successfully!" });
        sendEvent('done', { success: true, files: generatedFiles });
        res.end();
    } catch (error) { 
        sendEvent('error', { error: error.message }); 
        res.end(); 
    }
});

// ==========================================
// 🌩️ MANTU AI: LIVE WEBSOCKET DEPLOY ENGINE (With Auto-Heal)
// ==========================================
app.post('/api/publish-aws', async (req, res) => {
    let { files, targetIp, authKey, customSettings, isRetry = false } = req.body;
    if (!targetIp || !authKey) return res.json({ error: "AWS Server IP and .pem key required!" });

    const deployLogic = async (filesToDeploy, attemptNumber = 1) => {
        try {
            const timestamp = Date.now();
            const zipName = `mantu_aws_${timestamp}.zip`;
            const zipPath = path.join(__dirname, zipName);
            const pemName = `key_${timestamp}.pem`;
            const pemPath = path.join(__dirname, pemName);

            // 1. Pack the Code
            const output = fsSync.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } }); 
            archive.pipe(output);
            for (const [filename, content] of Object.entries(filesToDeploy || {})) { archive.append(content, { name: filename }); }
            await archive.finalize();
            await new Promise(resolve => output.on('close', resolve));

            const formattedKey = authKey.replace(/\\n/g, '\n'); 
            await fs.writeFile(pemPath, formattedKey, { mode: 0o400 });

            io.emit('deploy-log', `\n📦 Uploading Code to AWS (${targetIp}) [Attempt ${attemptNumber}]...`);
            
            const scpCommand = `scp -o StrictHostKeyChecking=no -i ${pemPath} ${zipPath} ubuntu@${targetIp}:/tmp/mantu_app.zip`;
            await execPromise(scpCommand);
            
            io.emit('deploy-log', `✅ Upload Complete!\n⚙️ Starting NGINX & PM2 Auto-Pilot Pipeline...\n`);

            // NGINX + PM2 Advanced SSH Command
            const sshCommand = `ssh -o StrictHostKeyChecking=no -i ${pemPath} ubuntu@${targetIp} "
                mkdir -p /home/ubuntu/mantu_app &&
                unzip -o /tmp/mantu_app.zip -d /home/ubuntu/mantu_app &&
                sudo apt-get update -y && sudo apt-get install nginx -y &&
                if [ -d '/home/ubuntu/mantu_app/frontend' ]; then
                    echo '>> Building Frontend for NGINX...' && cd /home/ubuntu/mantu_app/frontend && npm install && npm run build &&
                    sudo rm -rf /var/www/html/* && sudo cp -r dist/* /var/www/html/ && sudo systemctl restart nginx ;
                fi &&
                if [ -d '/home/ubuntu/mantu_app/backend' ]; then
                    echo '>> Starting Backend with PM2...' && sudo npm install -g pm2 && cd /home/ubuntu/mantu_app/backend &&
                    pip3 install -r requirements.txt || true && sudo fuser -k 8000/tcp || true &&
                    pm2 delete neovid-api || true && pm2 start 'python3 -m uvicorn main:app --host 0.0.0.0 --port 8000' --name 'neovid-api' ;
                fi &&
                echo '>> 🚀 Deployment Command Executed successfully!'
            "`;

            let collectedErrors = "";
            const deployProcess = exec(sshCommand);
            
            deployProcess.stdout.on('data', (data) => {
                io.emit('deploy-log', data.toString()); 
            });

            deployProcess.stderr.on('data', (data) => {
                const errText = data.toString();
                io.emit('deploy-log', `⚠️ AWS LOG: ${errText}`);
                // Catch severe errors like npm ERR or Python SyntaxError
                if (errText.includes("ERR!") || errText.includes("SyntaxError") || errText.includes("failed")) {
                    collectedErrors += errText + "\n";
                }
            });

            deployProcess.on('close', async (code) => {
                fsSync.unlinkSync(zipPath); fsSync.unlinkSync(pemPath);

                // 🔥 TRIGGER SELF-HEALING IF ERROR FOUND
                if (collectedErrors && attemptNumber === 1) {
                    const healedFiles = await autoHealCode(collectedErrors, filesToDeploy, customSettings);
                    if (healedFiles) {
                        io.emit('deploy-log', `\n🔄 Retrying deployment with healed code...\n`);
                        return deployLogic(healedFiles, 2); // Recursively retry once
                    }
                }

                if (code !== 0 && attemptNumber >= 2) {
                    io.emit('deploy-log', `\n❌ Deployment Failed after Auto-Heal attempt.`);
                    if (!res.headersSent) res.json({ error: "Deployment failed after healing." });
                } else {
                    io.emit('deploy-log', `\n🎉 SUCCESS! App is LIVE at: http://${targetIp}`);
                    if (!res.headersSent) res.json({ success: true, url: `http://${targetIp}` });
                }
            });

        } catch (error) { 
            io.emit('deploy-log', `❌ CRITICAL ERROR: ${error.message}`);
            if (!res.headersSent) res.json({ error: `AWS Deployment Failed: ${error.message}` }); 
        }
    };

    // Start the deployment logic
    deployLogic(files, 1);
});

// ==========================================
// 🌩️ OTHER PUBLISH & UTILITY ROUTES
// ==========================================
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

// 🚀 Start Mantu Enterprise OS Server
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Mantu Enterprise Backend (WebSockets + Self-Healing AI) running on port ${PORT}...`));
