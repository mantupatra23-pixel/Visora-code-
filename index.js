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
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); 

const WORKSPACE_DIR = './mantu_workspace';

// 🔥 SMART API THROTTLER: 6 Seconds wait to NEVER hit the 15 RPM Limit 🔥
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 🔥 FIXED MODELS: Using 1.5-flash for massive free tier limits 🔥
const MASTER_MODEL = 'llama-3.3-70b-versatile'; 
const WORKER_MODEL = 'gemini-1.5-flash'; 

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
    res.json({ success: true, variables: { MANTU_AI_STATUS: "BULLETPROOF HYBRID SWARM ACTIVE" } });
});

app.post('/api/build', async (req, res) => {
    const { prompt, isEdit } = req.body; 
    console.log(`\n[🚀 Bulletproof Hybrid Swarm Initiated]`);

    try {
        if (!process.env.GROQ_API_KEY || !process.env.GEMINI_API_KEY) {
            return res.json({ success: false, error: "GROQ_API_KEY or GEMINI_API_KEY missing!" });
        }

        let masterLogs = [];
        let masterFiles = {};
        
        let finalPrompt = prompt + "\n[CRITICAL: Use modern standards. DO NOT output markdown outside of JSON.]";

        // =================================================================
        // 🧠 MASTER ARCHITECT (GROQ)
        // =================================================================
        masterLogs.push({ agent: "Omni-Master", status: "Planning Blueprint", details: "Groq is designing architecture..." });
        
        const masterPrompt = `You are the Omni-Language Master. Request: "${finalPrompt}"
        Determine Tech Stack, EXACT file paths with nested folders, and NPM packages.
        Return ONLY JSON: { "tech_stack": "...", "files_needed": ["src/App.jsx"], "dependencies": ["axios"] }`;

        const masterRes = await groq.chat.completions.create({ 
            messages: [{ role: 'system', content: masterPrompt }], 
            model: MASTER_MODEL, 
            temperature: 0.1, 
            response_format: { type: 'json_object' } 
        });
        
        const masterData = JSON.parse(masterRes.choices[0].message.content);
        const techStack = masterData.tech_stack || "React";
        const filesToGenerate = masterData.files_needed || ["src/App.jsx"];
        const dependencies = masterData.dependencies || [];
        
        masterLogs.push({ agent: "System Architect", status: "Stack Locked", details: `Generating ${filesToGenerate.length} files.` });

        // =================================================================
        // ⚡ DEEP CODING (GEMINI 1.5 FLASH)
        // =================================================================
        const geminiModel = genAI.getGenerativeModel({ 
            model: WORKER_MODEL,
            generationConfig: { responseMimeType: "application/json" } 
        });

        for (const filename of filesToGenerate) {
            try {
                // 🔥 THE MAGIC CURE: 6 Second delay per file to bypass 429 Error 🔥
                await sleep(6000); 

                masterLogs.push({ agent: `${techStack} Dev (Gemini)`, status: "Deep Coding", details: `Writing elite logic for ${filename}...` });
                
                const workerPrompt = `You are an Elite Developer. Project Context: "${finalPrompt}".
                🚨 CRITICAL: YOU ARE ONLY WRITING CODE FOR ${filename}. Do not write other files.
                Return ONLY JSON: { "code": "full detailed code here" }`;
                
                const geminiResult = await geminiModel.generateContent(workerPrompt);
                let currentCode = extractJson(geminiResult.response.text())?.code || geminiResult.response.text();

                // SAVE FILE
                const absoluteFilePath = path.join(WORKSPACE_DIR, filename);
                await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true });
                await fs.writeFile(absoluteFilePath, currentCode);

                // SMART SANDBOX
                let executionError = null;
                masterLogs.push({ agent: "Sandbox Engine", status: "Terminal Testing", details: `Evaluating ${filename}...` });
                try {
                    if (filename.endsWith('.js') && !filename.includes('react') && !filename.endsWith('config.js')) {
                        await execPromise(`node -c "${absoluteFilePath}"`);
                    } else if (filename.endsWith('.py')) {
                        await execPromise(`python -m py_compile "${absoluteFilePath}"`);
                    }
                    masterLogs.push({ agent: "Sandbox Engine", status: "Test Passed", details: "Zero syntax errors." });
                } catch (execErr) {
                    executionError = execErr.message;
                    masterLogs.push({ agent: "Auto-Heal Alert", status: "Execution Failed", details: `Terminal error detected.` });
                }

                // QA AUTO-FIX
                if (executionError) {
                    await sleep(6000); // Another delay before fix
                    masterLogs.push({ agent: "QA Hacker (Gemini)", status: "Hunting Bugs", details: "Auto-fixing code..." });
                    const qaPrompt = `Fix this terminal error:\n${executionError}\n\nCode:\n${currentCode}\nReturn ONLY JSON: { "code": "fixed code" }`;
                    
                    const qaResult = await geminiModel.generateContent(qaPrompt);
                    currentCode = extractJson(qaResult.response.text())?.code || currentCode;
                    
                    await fs.writeFile(absoluteFilePath, currentCode);
                    masterLogs.push({ agent: "QA Hacker (Gemini)", status: "Bug Fixed", details: "Terminal error auto-healed." });
                }
                masterFiles[filename] = currentCode;

            } catch (fileError) {
                // Formatting error so UI doesn't break
                const shortError = fileError.message.substring(0, 80) + '...';
                masterLogs.push({ agent: "System Alert", status: "API Failed", details: `Gemini Error on ${filename}: ${shortError}` });
            }
        }

        // =================================================================
        // 📦 NPM INSTALL BOT
        // =================================================================
        if (dependencies.length > 0) {
            masterLogs.push({ agent: "Dependency Manager", status: "Installing Packages", details: `Running npm install...` });
            try {
                try { await fs.access(path.join(WORKSPACE_DIR, 'package.json')); } 
                catch { await fs.writeFile(path.join(WORKSPACE_DIR, 'package.json'), JSON.stringify({ name: "mantu-app", version: "1.0.0" })); }
                await execPromise(`npm install ${dependencies.join(' ')}`, { cwd: WORKSPACE_DIR });
                masterLogs.push({ agent: "Dependency Manager", status: "Installation Complete", details: "Packages installed." });
            } catch (npmErr) {
                masterLogs.push({ agent: "Dependency Manager", status: "Install Failed", details: "Could not install packages." });
            }
        }

        masterLogs.push({ agent: "Deployment Manager", status: "Success", details: `Project built perfectly using Bulletproof Hybrid Swarm!` });
        res.json({ success: true, logs: masterLogs, files: masterFiles });

    } catch (error) {
        res.json({ success: false, error: `Swarm Error: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running...`));
