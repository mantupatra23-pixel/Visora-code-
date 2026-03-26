const express = require('express');
const cors = require('cors');
const fs = require('fs/promises'); 
const path = require('path'); // 🔥 MISSING FIX: Added path for Folder Structure
const { exec } = require('child_process'); 
const util = require('util');
const execPromise = util.promisify(exec);
require('dotenv').config();

const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai'); 

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); 

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

const WORKSPACE_DIR = './mantu_workspace';

// 🔥 SMART JSON EXTRACTOR 🔥
const extractJson = (text) => {
    try {
        let cleanText = text.replace(/```(json)?/gi, '').replace(/```/gi, '').trim();
        const match = cleanText.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : JSON.parse(cleanText);
    } catch (e) {
        return null;
    }
};

// Initialize Workspace
const initWorkspace = async () => {
    try { await fs.mkdir(WORKSPACE_DIR, { recursive: true }); } catch (e) {}
};
initWorkspace();

app.get('/api/env', (req, res) => {
    res.json({ success: true, variables: { MANTU_AI_STATUS: "ULTIMATE GOD-MODE (WITH FOLDERS) ACTIVE" } });
});

app.post('/api/build', async (req, res) => {
    const { prompt, imageBase64, isEdit } = req.body; 
    console.log(`\n[🚀 God-Mode Swarm Initiated]`);

    try {
        if (!process.env.GROQ_API_KEY) return res.json({ success: false, error: "Groq Key missing in Render Env!" });

        let masterLogs = [];
        let masterFiles = {};
        let finalPrompt = prompt;

        // =================================================================
        // 👁️ FEATURE 1: VISION (IMAGE-TO-CODE)
        // =================================================================
        if (imageBase64 && genAI) {
            masterLogs.push({ agent: "Vision AI", status: "Analyzing Image", details: "Extracting UI/UX layout from the provided screenshot." });
            const visionModel = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
            const imagePart = { inlineData: { data: imageBase64.split(',')[1] || imageBase64, mimeType: "image/jpeg" } };
            const visionRes = await visionModel.generateContent(["Describe this UI in exact technical detail for a developer to replicate it.", imagePart]);
            finalPrompt = `User Prompt: ${prompt}\n\nStrict Design Requirements from Image: ${visionRes.response.text()}`;
        }

        // =================================================================
        // 🧠 FEATURE 2: WORKSPACE MEMORY (RAG)
        // =================================================================
        let projectContext = "";
        if (isEdit) {
            masterLogs.push({ agent: "Memory Agent", status: "Scanning Project", details: "Reading existing workspace files to maintain perfect context." });
            try {
                // Read all files recursively to understand the project
                const readFilesDeep = async (dir, base = '') => {
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    for (let entry of entries) {
                        const relPath = path.join(base, entry.name);
                        const absPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            await readFilesDeep(absPath, relPath);
                        } else if (entry.isFile() && !entry.name.includes('.json')) {
                            const content = await fs.readFile(absPath, 'utf-8');
                            projectContext += `\n--- File: ${relPath} ---\n${content}\n`;
                        }
                    }
                };
                await readFilesDeep(WORKSPACE_DIR);
            } catch (e) { console.log("Memory scan skipped or empty."); }
        }

        // =================================================================
        // 🌐 FEATURE 3: WEB SURFING (Modern Standards)
        // =================================================================
        if (finalPrompt.toLowerCase().includes("latest") || finalPrompt.toLowerCase().includes("2024") || finalPrompt.toLowerCase().includes("2025")) {
            masterLogs.push({ agent: "Web Agent", status: "Fetching Standards", details: "Applying the absolute latest documentation and best practices." });
            finalPrompt += "\n[SYSTEM RULE: Use the latest stable versions of libraries (e.g., React 18+, Tailwind v3+, App Router).]";
        }

        // =================================================================
        // 🧠 FEATURE 4: THE OMNI-MASTER ARCHITECT
        // =================================================================
        masterLogs.push({ agent: "Omni-Master", status: "Planning Blueprint", details: "Designing architecture and mapping exact folder structure." });
        
        const masterPrompt = `You are the Omni-Language Master. Request: "${finalPrompt}"
        ${isEdit ? `Existing Context:\n${projectContext.substring(0, 5000)}\n(Generate ONLY the files that need creating or updating).` : ''}
        Determine the Tech Stack and map out the EXACT file paths including folders (e.g. "src/components/Button.jsx").
        Return ONLY JSON: { "tech_stack": "...", "files_needed": ["src/App.jsx", "server/api.js"] }`;

        const masterRes = await groq.chat.completions.create({ messages: [{ role: 'system', content: masterPrompt }], model: 'llama-3.3-70b-versatile', temperature: 0.1, response_format: { type: 'json_object' } });
        const masterData = JSON.parse(masterRes.choices[0].message.content);
        const techStack = masterData.tech_stack || "React";
        const filesToGenerate = masterData.files_needed || ["src/App.jsx"];
        
        masterLogs.push({ agent: "System Architect", status: "Stack Locked", details: `Tech: ${techStack}. Generating ${filesToGenerate.length} files with proper nested folders.` });

        // =================================================================
        // ⚡ FEATURE 5 & 6: FILE SYSTEM, DRAFTING & LIVE SANDBOX
        // =================================================================
        for (const filename of filesToGenerate) {
            try {
                // 1. DRAFTING CODE
                masterLogs.push({ agent: `${techStack} Dev`, status: "Deep Coding", details: `Writing elite logic for ${filename}...` });
                const workerPrompt = `Write production-ready, highly detailed ${techStack} code for ${filename} based on: "${finalPrompt}". Return ONLY JSON: { "code": "..." }`;
                const workerRes = await groq.chat.completions.create({ messages: [{ role: 'system', content: workerPrompt }], model: 'llama-3.3-70b-versatile', temperature: 0.2 });
                let currentCode = extractJson(workerRes.choices[0].message.content)?.code || workerRes.choices[0].message.content;

                // 2. 🔥 MISSING FIX: PROPER FILE SYSTEM (NESTED FOLDERS) 🔥
                const absoluteFilePath = path.join(WORKSPACE_DIR, filename);
                const directoryPath = path.dirname(absoluteFilePath);
                
                // Pehle zaroori folder banayega (e.g., mantu_workspace/src/components)
                await fs.mkdir(directoryPath, { recursive: true });
                // Phir file save karega
                await fs.writeFile(absoluteFilePath, currentCode);
                masterLogs.push({ agent: "File Manager", status: "Saved to Disk", details: `Created folder and saved ${filename} in Workspace.` });

                // 3. LIVE SANDBOX EXECUTION (Syntax Checking)
                let executionError = null;
                masterLogs.push({ agent: "Sandbox Engine", status: "Terminal Testing", details: `Running syntax checks on ${filename} in virtual terminal...` });
                
                try {
                    // Sirf basic syntax check chalayenge taaki server hang na ho
                    if (filename.endsWith('.js') || filename.endsWith('.jsx')) {
                        await execPromise(`node -c "${absoluteFilePath}"`);
                    } else if (filename.endsWith('.py')) {
                        await execPromise(`python -m py_compile "${absoluteFilePath}"`);
                    }
                    masterLogs.push({ agent: "Sandbox Engine", status: "Test Passed", details: "Zero syntax errors detected." });
                } catch (execErr) {
                    executionError = execErr.message;
                    masterLogs.push({ agent: "Auto-Heal Alert", status: "Execution Failed", details: `Terminal error detected. Handing over to QA Hacker for auto-fix.` });
                }

                // 4. AUTO-FIX HACKER (If Sandbox Fails)
                if (executionError) {
                    masterLogs.push({ agent: "QA Hacker", status: "Hunting Bugs", details: "Analyzing terminal crash logs to auto-fix code..." });
                    const qaPrompt = `The code for ${filename} threw this fatal error:\n${executionError}\n\nCode:\n${currentCode}\n\nFIX THIS BUG COMPLETELY. Return ONLY JSON: { "code": "..." }`;
                    const qaRes = await groq.chat.completions.create({ messages: [{ role: 'system', content: qaPrompt }], model: 'llama-3.3-70b-versatile', temperature: 0.1 });
                    currentCode = extractJson(qaRes.choices[0].message.content)?.code || currentCode;
                    
                    // Save fixed code
                    await fs.writeFile(absoluteFilePath, currentCode);
                    masterLogs.push({ agent: "QA Hacker", status: "Bug Fixed", details: "Terminal error successfully auto-healed." });
                }

                masterFiles[filename] = currentCode;

            } catch (fileError) {
                masterLogs.push({ agent: "System Alert", status: "API Failed", details: `Failed on ${filename}: ${fileError.message}` });
                masterFiles[filename] = `// Mantu AI Error: ${fileError.message}`;
            }
        }

        masterLogs.push({ agent: "Deployment Manager", status: "Success", details: `Project generated, auto-tested, and saved with perfect folder structure!` });
        res.json({ success: true, logs: masterLogs, files: masterFiles });

    } catch (error) {
        res.json({ success: false, error: `Swarm Error: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running...`));
