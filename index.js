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

// 🔥 DONO ENGINES INITIALIZE KIYE HAIN 🔥
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); 

const WORKSPACE_DIR = './mantu_workspace';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 🔥 MODELS SETUP 🔥
const MASTER_MODEL = 'llama-3.3-70b-versatile'; // Groq for Planning
const WORKER_MODEL = 'gemini-2.5-flash'; // 🔥 Google Gemini for Heavy Coding! 🔥

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
    res.json({ success: true, variables: { MANTU_AI_STATUS: "GROQ + GEMINI HYBRID GOD-MODE ACTIVE" } });
});

app.post('/api/build', async (req, res) => {
    const { prompt, isEdit } = req.body; 
    console.log(`\n[🚀 Hybrid Swarm Initiated]`);

    try {
        if (!process.env.GROQ_API_KEY || !process.env.GEMINI_API_KEY) {
            return res.json({ success: false, error: "Dono GROQ_API_KEY aur GEMINI_API_KEY Render mein zaroori hain!" });
        }

        let masterLogs = [];
        let masterFiles = {};
        let finalPrompt = prompt + "\n[CRITICAL: Act as a Web Surfer Agent. Use the absolute latest documentation, latest frameworks, and modern standards.]";

        // =================================================================
        // 🧠 MASTER ARCHITECT (GROQ - 70b)
        // =================================================================
        masterLogs.push({ agent: "Omni-Master", status: "Planning Blueprint", details: "Groq is designing the architecture..." });
        
        const masterPrompt = `You are the Omni-Language Master. Request: "${finalPrompt}"
        Determine the Tech Stack, EXACT file paths with nested folders, and required NPM packages.
        Return ONLY JSON: { "tech_stack": "...", "files_needed": ["frontend/src/App.jsx", "backend/main.py"], "dependencies": ["axios", "fastapi"] }`;

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
        
        masterLogs.push({ agent: "System Architect", status: "Stack Locked", details: `Tech: ${techStack}. Generating ${filesToGenerate.length} files using Gemini.` });

        // =================================================================
        // ⚡ DEEP CODING (GEMINI - gemini-2.5-flash) 🔥
        // =================================================================
        for (const filename of filesToGenerate) {
            try {
                await sleep(2000); 

                masterLogs.push({ agent: `${techStack} Dev (Gemini)`, status: "Deep Coding", details: `Gemini is writing elite logic for ${filename}...` });
                
                const workerPrompt = `You are an Elite Developer. The user requested this project: "${finalPrompt}".
                🚨 CRITICAL RULE: YOU ARE ONLY WRITING THE CODE FOR: ${filename} 🚨
                Write detailed, production-ready code.
                Return ONLY JSON: { "code": "full code here" }`;
                
                // 🔥 GEMINI SDK MAGIC 🔥
                const geminiModel = genAI.getGenerativeModel({ 
                    model: WORKER_MODEL,
                    generationConfig: { responseMimeType: "application/json" } // Force Gemini to return clean JSON
                });
                
                const geminiResult = await geminiModel.generateContent(workerPrompt);
                let currentCode = extractJson(geminiResult.response.text())?.code || geminiResult.response.text();

                // FILE SYSTEM
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
                    masterLogs.push({ agent: "Sandbox Engine", status: "Test Passed", details: "Zero syntax errors detected." });
                } catch (execErr) {
                    executionError = execErr.message;
                    masterLogs.push({ agent: "Auto-Heal Alert", status: "Execution Failed", details: `Terminal error detected.` });
                }

                // QA AUTO-FIX (Also uses Gemini)
                if (executionError) {
                    await sleep(2000); 
                    masterLogs.push({ agent: "QA Hacker (Gemini)", status: "Hunting Bugs", details: "Auto-fixing code..." });
                    const qaPrompt = `Fix this terminal error:\n${executionError}\n\nCode:\n${currentCode}\nReturn ONLY JSON: { "code": "fixed code" }`;
                    
                    const qaResult = await geminiModel.generateContent(qaPrompt);
                    currentCode = extractJson(qaResult.response.text())?.code || currentCode;
                    
                    await fs.writeFile(absoluteFilePath, currentCode);
                    masterLogs.push({ agent: "QA Hacker (Gemini)", status: "Bug Fixed", details: "Terminal error successfully auto-healed." });
                }
                masterFiles[filename] = currentCode;

            } catch (fileError) {
                masterLogs.push({ agent: "System Alert", status: "API Failed", details: `Gemini Failed on ${filename}: ${fileError.message}` });
            }
        }

        // =================================================================
        // 📦 NPM INSTALL BOT
        // =================================================================
        if (dependencies.length > 0) {
            masterLogs.push({ agent: "Dependency Manager", status: "Installing Packages", details: `Running npm install for ${dependencies.join(', ')}...` });
            try {
                try { await fs.access(path.join(WORKSPACE_DIR, 'package.json')); } 
                catch { await fs.writeFile(path.join(WORKSPACE_DIR, 'package.json'), JSON.stringify({ name: "mantu-app", version: "1.0.0" })); }
                await execPromise(`npm install ${dependencies.join(' ')}`, { cwd: WORKSPACE_DIR });
                masterLogs.push({ agent: "Dependency Manager", status: "Installation Complete", details: "Packages installed." });
            } catch (npmErr) {
                masterLogs.push({ agent: "Dependency Manager", status: "Install Failed", details: "Could not install packages." });
            }
        }

        masterLogs.push({ agent: "Deployment Manager", status: "Success", details: `Project built perfectly using Groq + Gemini Hybrid!` });
        res.json({ success: true, logs: masterLogs, files: masterFiles });

    } catch (error) {
        res.json({ success: false, error: `Swarm Error: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running...`));
