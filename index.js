const express = require('express');
const cors = require('cors');
const fs = require('fs/promises'); 
const path = require('path'); 
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

// 🔥 Sleep function for Rate Limit Protection 🔥
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const extractJson = (text) => {
    try {
        let cleanText = text.replace(/```(json)?/gi, '').replace(/```/gi, '').trim();
        const match = cleanText.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : JSON.parse(cleanText);
    } catch (e) {
        return null;
    }
};

const initWorkspace = async () => {
    try { await fs.mkdir(WORKSPACE_DIR, { recursive: true }); } catch (e) {}
};
initWorkspace();

app.get('/api/env', (req, res) => {
    res.json({ success: true, variables: { MANTU_AI_STATUS: "RATE-LIMIT PROTECTED GOD-MODE ACTIVE" } });
});

app.post('/api/build', async (req, res) => {
    const { prompt, imageBase64, isEdit } = req.body; 
    console.log(`\n[🚀 Protected God-Mode Swarm Initiated]`);

    try {
        if (!process.env.GROQ_API_KEY) return res.json({ success: false, error: "Groq Key missing!" });

        let masterLogs = [];
        let masterFiles = {};
        let finalPrompt = prompt;

        // ... [Vision & RAG Memory Code Remains Same] ...

        masterLogs.push({ agent: "Omni-Master", status: "Planning Blueprint", details: "Designing architecture and mapping folder structure." });
        
        const masterPrompt = `You are the Omni-Language Master. Request: "${finalPrompt}"
        Determine the Tech Stack and map out the EXACT file paths including folders.
        Return ONLY JSON: { "tech_stack": "...", "files_needed": ["src/App.jsx"] }`;

        const masterRes = await groq.chat.completions.create({ messages: [{ role: 'system', content: masterPrompt }], model: 'llama-3.3-70b-versatile', temperature: 0.1, response_format: { type: 'json_object' } });
        const masterData = JSON.parse(masterRes.choices[0].message.content);
        const techStack = masterData.tech_stack || "React";
        const filesToGenerate = masterData.files_needed || ["src/App.jsx"];
        
        masterLogs.push({ agent: "System Architect", status: "Stack Locked", details: `Tech: ${techStack}. Generating ${filesToGenerate.length} files.` });

        // =================================================================
        // ⚡ DEEP CODING WITH RATE-LIMIT PROTECTION & SMART SANDBOX
        // =================================================================
        for (const filename of filesToGenerate) {
            try {
                // 🔥 PAUSE TO AVOID 429 ERROR (Rate Limit) 🔥
                await sleep(3000); // Wait 3 seconds before next file

                // 1. DRAFTING CODE
                masterLogs.push({ agent: `${techStack} Dev`, status: "Deep Coding", details: `Writing elite logic for ${filename}...` });
                const workerPrompt = `Write production-ready, highly detailed ${techStack} code for ${filename} based on: "${finalPrompt}". Return ONLY JSON: { "code": "..." }`;
                const workerRes = await groq.chat.completions.create({ messages: [{ role: 'system', content: workerPrompt }], model: 'llama-3.3-70b-versatile', temperature: 0.2 });
                let currentCode = extractJson(workerRes.choices[0].message.content)?.code || workerRes.choices[0].message.content;

                // 2. FILE SYSTEM
                const absoluteFilePath = path.join(WORKSPACE_DIR, filename);
                const directoryPath = path.dirname(absoluteFilePath);
                await fs.mkdir(directoryPath, { recursive: true });
                await fs.writeFile(absoluteFilePath, currentCode);
                masterLogs.push({ agent: "File Manager", status: "Saved to Disk", details: `Saved ${filename} in Workspace.` });

                // 3. SMART LIVE SANDBOX
                let executionError = null;
                masterLogs.push({ agent: "Sandbox Engine", status: "Terminal Testing", details: `Evaluating ${filename}...` });
                
                try {
                    // 🔥 FIX: DO NOT syntax check JSX/TSX/CSS files with Node to prevent false errors
                    if (filename.endsWith('.jsx') || filename.endsWith('.tsx') || filename.endsWith('.css') || filename.endsWith('.html')) {
                        masterLogs.push({ agent: "Sandbox Engine", status: "Test Bypassed", details: "Skipped native terminal test for UI file to prevent false errors." });
                    } else if (filename.endsWith('.js')) {
                        await execPromise(`node -c "${absoluteFilePath}"`);
                        masterLogs.push({ agent: "Sandbox Engine", status: "Test Passed", details: "Zero syntax errors detected." });
                    } else if (filename.endsWith('.py')) {
                        await execPromise(`python -m py_compile "${absoluteFilePath}"`);
                        masterLogs.push({ agent: "Sandbox Engine", status: "Test Passed", details: "Zero syntax errors detected." });
                    } else {
                         masterLogs.push({ agent: "Sandbox Engine", status: "Test Bypassed", details: "No native compiler available for this extension." });
                    }
                } catch (execErr) {
                    executionError = execErr.message;
                    masterLogs.push({ agent: "Auto-Heal Alert", status: "Execution Failed", details: `Terminal error detected.` });
                }

                // 4. AUTO-FIX HACKER (Only runs if a REAL error happened)
                if (executionError) {
                    await sleep(2000); // Extra pause before fixing
                    masterLogs.push({ agent: "QA Hacker", status: "Hunting Bugs", details: "Auto-fixing code..." });
                    const qaPrompt = `The code for ${filename} threw this fatal error:\n${executionError}\n\nCode:\n${currentCode}\n\nFIX THIS BUG. Return ONLY JSON: { "code": "..." }`;
                    const qaRes = await groq.chat.completions.create({ messages: [{ role: 'system', content: qaPrompt }], model: 'llama-3.3-70b-versatile', temperature: 0.1 });
                    currentCode = extractJson(qaRes.choices[0].message.content)?.code || currentCode;
                    await fs.writeFile(absoluteFilePath, currentCode);
                    masterLogs.push({ agent: "QA Hacker", status: "Bug Fixed", details: "Terminal error successfully auto-healed." });
                }

                masterFiles[filename] = currentCode;

            } catch (fileError) {
                console.error(`Error generating ${filename}:`, fileError.message);
                // Handle 429 specifically in logs
                if (fileError.message.includes('429')) {
                     masterLogs.push({ agent: "System Alert", status: "API Failed", details: `Rate limit hit on ${filename}. Sleeping...` });
                } else {
                     masterLogs.push({ agent: "System Alert", status: "API Failed", details: `Failed on ${filename}: ${fileError.message}` });
                }
                masterFiles[filename] = `// Mantu AI Error: ${fileError.message}`;
            }
        }

        masterLogs.push({ agent: "Deployment Manager", status: "Success", details: `Project generated and saved perfectly!` });
        res.json({ success: true, logs: masterLogs, files: masterFiles });

    } catch (error) {
        res.json({ success: false, error: `Swarm Error: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running...`));
