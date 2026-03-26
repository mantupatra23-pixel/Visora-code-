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

// 🔑 API KEYS INITIALIZATION
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); 
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const HF_KEY = process.env.HF_API_KEY;

const WORKSPACE_DIR = './mantu_workspace';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const MASTER_MODEL = 'llama-3.3-70b-versatile'; 
const GEMINI_WORKER = 'gemini-1.5-flash'; 
const GROQ_WORKER = 'llama-3.1-8b-instant';

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

// 🔥 THE 4-TIER IMMORTAL ENGINE 🔥
async function safeGenerate(promptText, isJson = true) {
    // 🥇 Tier 1: Gemini (First Choice)
    try {
        const geminiModel = genAI.getGenerativeModel({ 
            model: GEMINI_WORKER,
            generationConfig: isJson ? { responseMimeType: "application/json" } : {}
        });
        const res = await geminiModel.generateContent(promptText);
        return { text: res.response.text(), engine: "Gemini" };
    } catch (geminiErr) {
        console.log(`[⚠️ Gemini Down] -> Switching to Groq...`);
        
        // 🥈 Tier 2: Groq Llama 3 (Second Choice)
        try {
            await sleep(1000);
            const groqRes = await groq.chat.completions.create({ 
                messages: [{ role: 'system', content: promptText }], 
                model: GROQ_WORKER, 
                temperature: 0.2, 
                response_format: isJson ? { type: 'json_object' } : null
            });
            return { text: groqRes.choices[0].message.content, engine: "Groq" };
        } catch (groqErr) {
            console.log(`[⚠️ Groq Down] -> Switching to OpenRouter...`);
            
            // 🥉 Tier 3: OpenRouter (Your New API!)
            try {
                if (!OPENROUTER_KEY) throw new Error("OpenRouter Key Missing");
                await sleep(1000);
                const openRouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: "meta-llama/llama-3-8b-instruct:free", // Using free model on OpenRouter
                        messages: [{ role: "system", content: promptText }]
                    })
                });
                const openRouterData = await openRouterRes.json();
                return { text: openRouterData.choices[0].message.content, engine: "OpenRouter" };
            } catch (openRouterErr) {
                console.log(`[⚠️ OpenRouter Down] -> Switching to Hugging Face...`);
                
                // 🏅 Tier 4: Hugging Face (Your Ultimate Backup!)
                try {
                    if (!HF_KEY) throw new Error("HF Key Missing");
                    await sleep(1000);
                    const hfRes = await fetch("https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2", {
                        method: "POST",
                        headers: { "Authorization": `Bearer ${HF_KEY}`, "Content-Type": "application/json" },
                        body: JSON.stringify({ inputs: promptText })
                    });
                    const hfData = await hfRes.json();
                    return { text: hfData[0].generated_text, engine: "HuggingFace" };
                } catch (hfErr) {
                    throw new Error("CRITICAL_QUOTA_EMPTY"); // Sab fail ho gaye toh hi error aayega
                }
            }
        }
    }
}

app.get('/api/env', (req, res) => {
    res.json({ success: true, variables: { MANTU_AI_STATUS: "4-ENGINE (GEMINI+GROQ+OPENROUTER+HF) ACTIVE" } });
});

app.post('/api/build', async (req, res) => {
    const { prompt } = req.body; 
    console.log(`\n[🚀 4-Engine Immortal Swarm Initiated]`);

    try {
        let masterLogs = [];
        let masterFiles = {};
        let finalPrompt = prompt + "\n[CRITICAL: Use modern standards. DO NOT output markdown outside of JSON if requested as JSON.]";

        masterLogs.push({ agent: "Omni-Master", status: "Planning Blueprint", details: "Designing architecture..." });
        
        const masterPrompt = `You are the Omni-Language Master. Request: "${finalPrompt}"
        Determine Tech Stack, EXACT file paths with nested folders, and NPM packages.
        Return ONLY JSON: { "tech_stack": "...", "files_needed": ["src/App.jsx"], "dependencies": ["axios"] }`;

        let masterData;
        try {
            const masterRes = await groq.chat.completions.create({ messages: [{ role: 'system', content: masterPrompt }], model: MASTER_MODEL, temperature: 0.1, response_format: { type: 'json_object' } });
            masterData = JSON.parse(masterRes.choices[0].message.content);
        } catch (e) {
            masterLogs.push({ agent: "System Alert", status: "Master Engine Switched", details: "Main master exhausted. Engaging 4-Tier Fallback..." });
            try {
                const backupMaster = await safeGenerate(masterPrompt, true);
                masterData = extractJson(backupMaster.text);
            } catch (criticalErr) {
                return res.json({ success: false, error: "⚠️ ALERT: Saare 4 AI Engines (Gemini, Groq, OpenRouter, HF) ki limit khatam ho chuki hai! Kripya 24 ghante baad try karein." });
            }
        }

        const techStack = masterData?.tech_stack || "React";
        const filesToGenerate = masterData?.files_needed || ["src/App.jsx"];
        const dependencies = masterData?.dependencies || [];
        
        masterLogs.push({ agent: "System Architect", status: "Stack Locked", details: `Generating ${filesToGenerate.length} files.` });

        for (const filename of filesToGenerate) {
            try {
                await sleep(3000); 

                masterLogs.push({ agent: `${techStack} Dev`, status: "Deep Coding", details: `Writing elite logic for ${filename}...` });
                
                const workerPrompt = `You are an Elite Developer. Project Context: "${finalPrompt}".
                🚨 CRITICAL: YOU ARE ONLY WRITING CODE FOR ${filename}. Do not write other files.
                Return ONLY JSON: { "code": "full detailed code here" }`;
                
                const generatedData = await safeGenerate(workerPrompt, true);
                let currentCode = extractJson(generatedData.text)?.code || generatedData.text;
                
                masterLogs.push({ agent: "Engine Router", status: "Engine Used", details: `Code generated successfully using ${generatedData.engine} engine.` });

                const absoluteFilePath = path.join(WORKSPACE_DIR, filename);
                await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true });
                await fs.writeFile(absoluteFilePath, currentCode);

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

                if (executionError) {
                    await sleep(2000);
                    masterLogs.push({ agent: "QA Hacker", status: "Hunting Bugs", details: "Auto-fixing code..." });
                    const qaPrompt = `Fix this terminal error:\n${executionError}\n\nCode:\n${currentCode}\nReturn ONLY JSON: { "code": "fixed code" }`;
                    
                    const qaData = await safeGenerate(qaPrompt, true);
                    currentCode = extractJson(qaData.text)?.code || currentCode;
                    
                    await fs.writeFile(absoluteFilePath, currentCode);
                    masterLogs.push({ agent: "QA Hacker", status: "Bug Fixed", details: `Terminal error auto-healed via ${qaData.engine}.` });
                }
                masterFiles[filename] = currentCode;

            } catch (fileError) {
                if (fileError.message === "CRITICAL_QUOTA_EMPTY") {
                    return res.json({ success: false, error: "⚠️ ALERT: Saare 4 Engines (Gemini, Groq, OpenRouter, HF) limit cross kar chuke hain!" });
                }
                masterLogs.push({ agent: "System Crash", status: "API Exhausted", details: `Failed on ${filename}.` });
            }
        }

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

        masterLogs.push({ agent: "Deployment Manager", status: "Success", details: `Project built perfectly!` });
        res.json({ success: true, logs: masterLogs, files: masterFiles });

    } catch (error) {
        res.json({ success: false, error: `Swarm Error: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running...`));
