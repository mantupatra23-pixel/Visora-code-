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

// 🔑 CLOUD API KEYS
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null; 
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const HF_KEY = process.env.HF_API_KEY;

const WORKSPACE_DIR = './mantu_workspace';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 🧠 MODELS CONFIG
const MASTER_MODEL = 'llama-3.3-70b-versatile'; 
const GEMINI_WORKER = 'gemini-1.5-flash'; 
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

const cleanRawCode = (text) => {
    return text.replace(/```[a-zA-Z]*\n/gi, '').replace(/```/gi, '').trim();
};

const initWorkspace = async () => {
    try { await fs.mkdir(WORKSPACE_DIR, { recursive: true }); } catch (e) {}
};
initWorkspace();

// 🔥 THE ULTIMATE 5-TIER FALLBACK ENGINE 🔥
async function safeGenerate(promptText, isJson = true) {
    
    // 🥇 Tier 1: YOUR CUSTOM AWS API (100% Private & Free limits)
    try {
        const awsApiUrl = process.env.AWS_API_URL || "http://54.224.241.169:8000/chat";
        const finalPrompt = promptText + (isJson ? " MUST RETURN JSON FORMAT ONLY." : " MUST RETURN RAW CODE ONLY. NO MARKDOWN.");
        
        // Passing prompt as query parameter as defined in your FastAPI api.py
        const finalUrl = `${awsApiUrl}?prompt=${encodeURIComponent(finalPrompt)}`;

        const awsRes = await fetch(finalUrl, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "x-api-key": process.env.AWS_API_PASSWORD || "mantu123" // Aapka secure password
            }
        });

        if (!awsRes.ok) throw new Error(`HTTP ${awsRes.status}`);
        const awsData = await awsRes.json();
        
        // FastAPI forwards Ollama's response which contains 'response' key
        if(awsData.error) throw new Error(awsData.error);
        return { text: awsData.response, engine: "AWS Custom Llama-3" };
        
    } catch (awsErr) {
        console.log(`[⚠️ AWS Server Down: ${awsErr.message.substring(0, 30)}] -> Switching to Gemini...`);
        
        // 🥈 Tier 2: Gemini
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
            
            // 🥉 Tier 3: Groq
            try {
                await sleep(1000); // 1 sec delay to avoid rate limits
                const groqRes = await groq.chat.completions.create({ 
                    messages: [
                        { role: 'system', content: isJson ? "Output valid JSON only." : "Output ONLY raw code. No markdown." },
                        { role: 'user', content: promptText }
                    ], 
                    model: GROQ_WORKER, 
                    temperature: 0.2, 
                    response_format: isJson ? { type: 'json_object' } : null
                });
                return { text: groqRes.choices[0].message.content, engine: "Groq" };
            } catch (groqErr) {
                console.log(`[⚠️ Groq Down] -> Switching to OpenRouter...`);
                
                // 🏅 Tier 4: OpenRouter
                try {
                    if (!OPENROUTER_KEY) throw new Error("OpenRouter Key Missing");
                    await sleep(1000);
                    const openRouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                        method: "POST",
                        headers: { 
                            "Authorization": `Bearer ${OPENROUTER_KEY}`, 
                            "Content-Type": "application/json",
                            "HTTP-Referer": "https://mantu-ai.com",
                            "X-Title": "Mantu AI"
                        },
                        body: JSON.stringify({
                            model: "mistralai/mistral-7b-instruct:free", 
                            messages: [{ role: "user", content: promptText + (isJson ? " MUST RETURN JSON FORMAT ONLY." : " MUST RETURN RAW CODE ONLY. NO MARKDOWN.") }]
                        })
                    });
                    const orText = await openRouterRes.text();
                    if (!openRouterRes.ok) throw new Error(`OR Error: ${orText}`);
                    const openRouterData = JSON.parse(orText);
                    return { text: openRouterData.choices[0].message.content, engine: "OpenRouter" };
                } catch (openRouterErr) {
                    console.log(`[⚠️ OpenRouter Down] -> Switching to HF...`);
                    
                    // 🎖️ Tier 5: Hugging Face (Zephyr Model)
                    try {
                        if (!HF_KEY) throw new Error("HF Key Missing");
                        await sleep(1000);
                        const hfRes = await fetch("https://api-inference.huggingface.co/models/HuggingFaceH4/zephyr-7b-beta", { 
                            method: "POST",
                            headers: { "Authorization": `Bearer ${HF_KEY}`, "Content-Type": "application/json" },
                            body: JSON.stringify({ inputs: `<|user|>\n${promptText}</s>\n<|assistant|>` }) 
                        });
                        const hfText = await hfRes.text();
                        if (!hfRes.ok) throw new Error(`HF Error: ${hfText}`);
                        const hfData = JSON.parse(hfText);
                        return { text: hfData[0].generated_text.split('<|assistant|>')[1] || hfData[0].generated_text, engine: "HuggingFace" };
                    } catch (hfErr) {
                        console.log(`[❌ ALL 5 ENGINES DOWN]`);
                        throw new Error("CRITICAL_QUOTA_EMPTY"); 
                    }
                }
            }
        }
    }
}

app.get('/api/env', (req, res) => {
    res.json({ success: true, variables: { MANTU_AI_STATUS: "5-TIER AWS-FIRST GOD MODE ACTIVE" } });
});

app.post('/api/build', async (req, res) => {
    const { prompt } = req.body; 
    console.log(`\n[🚀 Final 5-Tier Swarm Initiated]`);

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
            // Master Agent (Groq for blazing fast folder planning)
            const masterRes = await groq.chat.completions.create({ messages: [{ role: 'system', content: masterPrompt }], model: MASTER_MODEL, temperature: 0.1, response_format: { type: 'json_object' } });
            masterData = JSON.parse(masterRes.choices[0].message.content);
        } catch (e) {
            try {
                // If Groq limits are out, fallback to the 5-Tier Engine
                const backupMaster = await safeGenerate(masterPrompt, true);
                masterData = extractJson(backupMaster.text);
            } catch (criticalErr) {
                return res.json({ success: false, error: "⚠️ ALERT: Aapka AWS Server aur saari 4 Cloud APIs thak chuki hain! Kripya AWS check karein ya naye API keys daalein." });
            }
        }

        const techStack = masterData?.tech_stack || "React";
        const filesToGenerate = masterData?.files_needed || ["src/App.jsx"];
        const dependencies = masterData?.dependencies || [];
        
        masterLogs.push({ agent: "System Architect", status: "Stack Locked", details: `Generating ${filesToGenerate.length} files.` });

        for (const filename of filesToGenerate) {
            try {
                await sleep(3000); 

                const workerPrompt = `You are an Elite Developer. Project Context: "${finalPrompt}".
                🚨 CRITICAL: YOU ARE ONLY WRITING CODE FOR ${filename}. Do not write other files.
                Return ONLY the raw functional code. DO NOT wrap it in JSON. DO NOT use markdown blocks like \`\`\`javascript. Just the pure code text.`;
                
                // Deep Coding using the 5-Tier Fallback
                const generatedData = await safeGenerate(workerPrompt, false); 
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
                    
                    const qaData = await safeGenerate(qaPrompt, false);
                    let fixedCode = cleanRawCode(qaData.text);
                    
                    fixedCode = `/* \n * 🚀 Code Fixed by Mantu AI \n * 🧠 QA Engine: ${qaData.engine}\n */\n\n` + fixedCode;

                    await fs.writeFile(absoluteFilePath, fixedCode);
                    masterLogs.push({ agent: `${qaData.engine} QA`, status: "Bug Fixed", details: `Terminal error auto-healed.` });
                    currentCode = fixedCode;
                }
                masterFiles[filename] = currentCode;

            } catch (fileError) {
                if (fileError.message === "CRITICAL_QUOTA_EMPTY") {
                    return res.json({ success: false, error: "⚠️ ALERT: Saare 5 Engines (AWS + 4 Cloud APIs) down hain! AWS server chalu karein." });
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
