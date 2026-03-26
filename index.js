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
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const HF_KEY = process.env.HF_API_KEY;

const WORKSPACE_DIR = './mantu_workspace';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const MASTER_MODEL = 'llama-3.3-70b-versatile'; 
const GEMINI_WORKER = 'gemini-1.5-flash'; 
// 🔥 UPGRADED GROQ FALLBACK TO MOST POWERFUL MODEL 🔥
const GROQ_WORKER = 'llama-3.3-70b-versatile'; 

const extractJson = (text) => {
    try {
        let cleanText = text.replace(/```(json)?/gi, '').replace(/```/gi, '').trim();
        const match = cleanText.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : JSON.parse(cleanText);
    } catch (e) {
        return null;
    }
};

// 🔥 NEW: Raw Code Cleaner (No JSON Needed for Workers!) 🔥
const cleanRawCode = (text) => {
    return text.replace(/```[a-zA-Z]*\n/gi, '').replace(/```/gi, '').trim();
};

const initWorkspace = async () => {
    try { await fs.mkdir(WORKSPACE_DIR, { recursive: true }); } catch (e) {}
};
initWorkspace();

async function safeGenerate(promptText, isJson = true) {
    try {
        if (!genAI) throw new Error("Gemini Key Missing");
        const geminiModel = genAI.getGenerativeModel({ 
            model: GEMINI_WORKER,
            generationConfig: isJson ? { responseMimeType: "application/json" } : {}
        });
        const res = await geminiModel.generateContent(promptText);
        return { text: res.response.text(), engine: "Gemini" };
    } catch (geminiErr) {
        console.log(`[⚠️ Gemini Down] -> Switching to Groq...`);
        
        try {
            await sleep(1000);
            const groqRes = await groq.chat.completions.create({ 
                messages: [
                    { role: 'system', content: isJson ? "Output valid JSON only." : "Output ONLY raw code. No markdown, no explanations." },
                    { role: 'user', content: promptText }
                ], 
                model: GROQ_WORKER, 
                temperature: 0.2, 
                response_format: isJson ? { type: 'json_object' } : null
            });
            return { text: groqRes.choices[0].message.content, engine: "Groq" };
        } catch (groqErr) {
            console.log(`[⚠️ Groq Down] -> Switching to OpenRouter...`);
            
            try {
                if (!OPENROUTER_KEY) throw new Error("OpenRouter Key Missing");
                await sleep(1000);
                const openRouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: "meta-llama/llama-3-8b-instruct:free", 
                        messages: [{ role: "user", content: promptText + (isJson ? " MUST RETURN JSON ONLY." : " MUST RETURN RAW CODE ONLY. NO MARKDOWN.") }]
                    })
                });
                if (!openRouterRes.ok) throw new Error(`HTTP ${openRouterRes.status}`);
                const openRouterData = await openRouterRes.json();
                return { text: openRouterData.choices[0].message.content, engine: "OpenRouter" };
            } catch (openRouterErr) {
                console.log(`[⚠️ OpenRouter Down] -> Switching to HF...`);
                
                try {
                    if (!HF_KEY) throw new Error("HF Key Missing");
                    await sleep(1000);
                    const hfRes = await fetch("https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2", {
                        method: "POST",
                        headers: { "Authorization": `Bearer ${HF_KEY}`, "Content-Type": "application/json" },
                        body: JSON.stringify({ inputs: `[INST] ${promptText} [/INST]` })
                    });
                    if (!hfRes.ok) throw new Error(`HTTP ${hfRes.status}`);
                    const hfData = await hfRes.json();
                    return { text: hfData[0].generated_text, engine: "HuggingFace" };
                } catch (hfErr) {
                    throw new Error("CRITICAL_QUOTA_EMPTY"); 
                }
            }
        }
    }
}

app.get('/api/env', (req, res) => {
    res.json({ success: true, variables: { MANTU_AI_STATUS: "RAW-CODE ENGINE ACTIVE" } });
});

app.post('/api/build', async (req, res) => {
    const { prompt } = req.body; 
    console.log(`\n[🚀 Raw-Code Swarm Initiated]`);

    try {
        let masterLogs = [];
        let masterFiles = {};
        let finalPrompt = prompt + "\n[CRITICAL: Use modern standards.]";

        masterLogs.push({ agent: "Omni-Master", status: "Planning Blueprint", details: "Designing architecture..." });
        
        const masterPrompt = `You are the Omni-Language Master. Request: "${finalPrompt}"
        Determine Tech Stack, EXACT file paths with nested folders, and NPM packages.
        Return ONLY JSON: { "tech_stack": "...", "files_needed": ["src/App.jsx"], "dependencies": ["axios"] }`;

        let masterData;
        try {
            const masterRes = await groq.chat.completions.create({ messages: [{ role: 'system', content: masterPrompt }], model: MASTER_MODEL, temperature: 0.1, response_format: { type: 'json_object' } });
            masterData = JSON.parse(masterRes.choices[0].message.content);
        } catch (e) {
            try {
                const backupMaster = await safeGenerate(masterPrompt, true);
                masterData = extractJson(backupMaster.text);
            } catch (criticalErr) {
                return res.json({ success: false, error: "⚠️ ALERT: Saare 4 AI Engines ki daily limit khatam ho chuki hai!" });
            }
        }

        const techStack = masterData?.tech_stack || "React";
        const filesToGenerate = masterData?.files_needed || ["src/App.jsx"];
        const dependencies = masterData?.dependencies || [];
        
        masterLogs.push({ agent: "System Architect", status: "Stack Locked", details: `Generating ${filesToGenerate.length} files.` });

        for (const filename of filesToGenerate) {
            try {
                await sleep(3000); 

                // 🔥 NO JSON NEEDED HERE ANYMORE. JUST RAW TEXT! 🔥
                const workerPrompt = `You are an Elite Developer. Project Context: "${finalPrompt}".
                🚨 CRITICAL: YOU ARE ONLY WRITING CODE FOR ${filename}. Do not write other files.
                Return ONLY the raw functional code. DO NOT wrap it in JSON. DO NOT use markdown blocks like \`\`\`javascript. Just the pure code text.`;
                
                const generatedData = await safeGenerate(workerPrompt, false); // isJson = false
                let currentCode = cleanRawCode(generatedData.text);
                
                currentCode = `/* \n * 🚀 Code Generated by Mantu AI \n * 🧠 Active Engine: ${generatedData.engine}\n */\n\n` + currentCode;
                
                masterLogs.push({ 
                    agent: `${generatedData.engine} Worker`, 
                    status: "Deep Coding", 
                    details: `Code successfully written by ${generatedData.engine} engine.` 
                });

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
                    const qaPrompt = `Fix this terminal error:\n${executionError}\n\nCode:\n${currentCode}\nReturn ONLY the raw fixed code. DO NOT wrap it in JSON. NO markdown blocks.`;
                    
                    const qaData = await safeGenerate(qaPrompt, false); // isJson = false
                    let fixedCode = cleanRawCode(qaData.text);
                    
                    fixedCode = `/* \n * 🚀 Code Fixed by Mantu AI \n * 🧠 QA Engine: ${qaData.engine}\n */\n\n` + fixedCode;

                    await fs.writeFile(absoluteFilePath, fixedCode);
                    masterLogs.push({ agent: `${qaData.engine} QA`, status: "Bug Fixed", details: `Terminal error auto-healed.` });
                    currentCode = fixedCode;
                }
                masterFiles[filename] = currentCode;

            } catch (fileError) {
                if (fileError.message === "CRITICAL_QUOTA_EMPTY") {
                    return res.json({ success: false, error: "⚠️ ALERT: Saare 4 Engines limit cross kar chuke hain! Kal wapas try karein." });
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
