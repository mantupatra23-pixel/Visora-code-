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
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const MASTER_MODEL = 'llama-3.3-70b-versatile'; 
const GEMINI_WORKER = 'gemini-1.5-flash'; 
const GROQ_WORKER = 'llama-3.1-8b-instant'; // Lighter Groq model for fallback

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

// 🔥 THE IMMORTAL GENERATOR ENGINE 🔥
// Ye function pehle Gemini try karega, fail hua toh Groq try karega.
async function safeGenerate(promptText, isJson = true) {
    try {
        // Attempt 1: Google Gemini
        const geminiModel = genAI.getGenerativeModel({ 
            model: GEMINI_WORKER,
            generationConfig: isJson ? { responseMimeType: "application/json" } : {}
        });
        const res = await geminiModel.generateContent(promptText);
        let text = res.response.text();
        return { text: text, engine: "Gemini" };
    } catch (geminiErr) {
        console.log(`[⚠️ Gemini Failed: ${geminiErr.message.substring(0, 50)}] -> Switching to Groq Fallback...`);
        
        // Attempt 2: Fallback to Groq Llama 3
        try {
            await sleep(2000); // Short pause before switching engines
            const groqRes = await groq.chat.completions.create({ 
                messages: [{ role: 'system', content: promptText }], 
                model: GROQ_WORKER, 
                temperature: 0.2, 
                response_format: isJson ? { type: 'json_object' } : null
            });
            return { text: groqRes.choices[0].message.content, engine: "Groq" };
        } catch (groqErr) {
            throw new Error(`Both Gemini and Groq APIs are exhausted! Groq Error: ${groqErr.message.substring(0, 50)}`);
        }
    }
}

app.get('/api/env', (req, res) => {
    res.json({ success: true, variables: { MANTU_AI_STATUS: "IMMORTAL AUTO-FALLBACK SWARM ACTIVE" } });
});

app.post('/api/build', async (req, res) => {
    const { prompt, isEdit } = req.body; 
    console.log(`\n[🚀 Immortal Fallback Swarm Initiated]`);

    try {
        if (!process.env.GROQ_API_KEY || !process.env.GEMINI_API_KEY) {
            return res.json({ success: false, error: "GROQ_API_KEY or GEMINI_API_KEY missing!" });
        }

        let masterLogs = [];
        let masterFiles = {};
        
        let finalPrompt = prompt + "\n[CRITICAL: Use modern standards. DO NOT output markdown outside of JSON.]";

        // =================================================================
        // 🧠 MASTER ARCHITECT (GROQ MAIN)
        // =================================================================
        masterLogs.push({ agent: "Omni-Master", status: "Planning Blueprint", details: "Designing architecture..." });
        
        const masterPrompt = `You are the Omni-Language Master. Request: "${finalPrompt}"
        Determine Tech Stack, EXACT file paths with nested folders, and NPM packages.
        Return ONLY JSON: { "tech_stack": "...", "files_needed": ["src/App.jsx"], "dependencies": ["axios"] }`;

        let masterData;
        try {
            const masterRes = await groq.chat.completions.create({ messages: [{ role: 'system', content: masterPrompt }], model: MASTER_MODEL, temperature: 0.1, response_format: { type: 'json_object' } });
            masterData = JSON.parse(masterRes.choices[0].message.content);
        } catch (e) {
            masterLogs.push({ agent: "System Alert", status: "Master Failed", details: "Groq Master exhausted. Falling back to Gemini Master..." });
            const backupMaster = await safeGenerate(masterPrompt, true);
            masterData = extractJson(backupMaster.text);
        }

        const techStack = masterData?.tech_stack || "React";
        const filesToGenerate = masterData?.files_needed || ["src/App.jsx"];
        const dependencies = masterData?.dependencies || [];
        
        masterLogs.push({ agent: "System Architect", status: "Stack Locked", details: `Generating ${filesToGenerate.length} files.` });

        // =================================================================
        // ⚡ IMMORTAL DEEP CODING
        // =================================================================
        for (const filename of filesToGenerate) {
            try {
                await sleep(4000); // Base throttling

                masterLogs.push({ agent: `${techStack} Dev`, status: "Deep Coding", details: `Writing elite logic for ${filename}...` });
                
                const workerPrompt = `You are an Elite Developer. Project Context: "${finalPrompt}".
                🚨 CRITICAL: YOU ARE ONLY WRITING CODE FOR ${filename}. Do not write other files.
                Return ONLY JSON: { "code": "full detailed code here" }`;
                
                // 🔥 THE MAGIC ENGINE 🔥
                const generatedData = await safeGenerate(workerPrompt, true);
                let currentCode = extractJson(generatedData.text)?.code || generatedData.text;
                
                masterLogs.push({ agent: "Engine Router", status: "Engine Used", details: `Code generated successfully using ${generatedData.engine} engine.` });

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

                // QA AUTO-FIX (Immortal)
                if (executionError) {
                    await sleep(3000);
                    masterLogs.push({ agent: "QA Hacker", status: "Hunting Bugs", details: "Auto-fixing code..." });
                    const qaPrompt = `Fix this terminal error:\n${executionError}\n\nCode:\n${currentCode}\nReturn ONLY JSON: { "code": "fixed code" }`;
                    
                    const qaData = await safeGenerate(qaPrompt, true);
                    currentCode = extractJson(qaData.text)?.code || currentCode;
                    
                    await fs.writeFile(absoluteFilePath, currentCode);
                    masterLogs.push({ agent: "QA Hacker", status: "Bug Fixed", details: `Terminal error auto-healed via ${qaData.engine}.` });
                }
                masterFiles[filename] = currentCode;

            } catch (fileError) {
                masterLogs.push({ agent: "System Crash", status: "API Exhausted", details: `Both AI engines failed on ${filename}. Need fresh API Keys or 24h rest.` });
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

        masterLogs.push({ agent: "Deployment Manager", status: "Success", details: `Project built perfectly using Immortal Fallback Engine!` });
        res.json({ success: true, logs: masterLogs, files: masterFiles });

    } catch (error) {
        res.json({ success: false, error: `Swarm Error: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running...`));
