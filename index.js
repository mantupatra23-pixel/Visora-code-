const express = require('express');
const cors = require('cors');
const fs = require('fs/promises'); 
const path = require('path'); 
require('dotenv').config();

const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai'); 

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Image upload ke liye 50mb limit

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null; 
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

const WORKSPACE_DIR = './mantu_workspace';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const MASTER_MODEL = 'llama-3.3-70b-versatile'; 
const GEMINI_WORKER = 'gemini-1.5-flash'; 

const extractJson = (text) => {
    try {
        let cleanText = text.replace(/```(json)?/gi, '').replace(/```/gi, '').trim();
        const match = cleanText.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : JSON.parse(cleanText);
    } catch (e) { return null; }
};

const cleanRawCode = (text) => text.replace(/```[a-zA-Z]*\n/gi, '').replace(/```/gi, '').trim();

// 🔥 THE 5-TIER ENGINE 🔥
async function safeGenerate(promptText, isJson = true, sendEvent = null) {
    // 🥇 Tier 1: AWS Llama-3 (30s Timeout)
    try {
        const awsApiUrl = process.env.AWS_API_URL || "http://54.224.241.169:8000/chat";
        const finalUrl = `${awsApiUrl}?prompt=${encodeURIComponent(promptText + (isJson ? " MUST RETURN JSON." : " RAW CODE ONLY."))}`;
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); 

        const awsRes = await fetch(finalUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": process.env.AWS_API_PASSWORD || "mantu_godmode_secure_999" },
            signal: controller.signal 
        });
        clearTimeout(timeoutId); 

        if (!awsRes.ok) throw new Error("AWS HTTP Error");
        const awsData = await awsRes.json();
        return { text: awsData.response, engine: "AWS Custom Llama-3" };
    } catch (awsErr) {
        // 🥈 Tier 2: Gemini
        try {
            if (!genAI) throw new Error("Gemini Key Missing");
            const geminiModel = genAI.getGenerativeModel({ model: GEMINI_WORKER, generationConfig: isJson ? { responseMimeType: "application/json" } : {} });
            const res = await geminiModel.generateContent(promptText);
            return { text: res.response.text(), engine: "Gemini" };
        } catch (geminiErr) {
            // 🥉 Tier 3: Groq
            try {
                await sleep(1000); 
                const groqRes = await groq.chat.completions.create({ 
                    messages: [
                        { role: 'system', content: isJson ? "Output valid JSON only." : "Output ONLY raw code. No markdown." },
                        { role: 'user', content: promptText }
                    ], 
                    model: MASTER_MODEL, temperature: 0.2, response_format: isJson ? { type: 'json_object' } : null
                });
                return { text: groqRes.choices[0].message.content, engine: "Groq" };
            } catch (groqErr) {
                throw new Error("ALL ENGINES FAILED"); 
            }
        }
    }
}

app.get('/api/env', (req, res) => res.json({ success: true, variables: { MANTU_AI_STATUS: "VISION + MEMORY ENGINE ACTIVE" } }));

app.post('/api/build', async (req, res) => {
    // 🔥 Naya Data: image (Base64) aur contextFiles (Memory) 🔥
    const { prompt, image, contextFiles } = req.body; 

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const sendEvent = (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

    try {
        let finalPrompt = prompt + "\n[CRITICAL: Use modern standards.]";
        let masterData;

        sendEvent('log', { agent: "Omni-Master", status: "Planning Blueprint", details: "Analyzing request..." });

        // 👁️ VISION ENGINE LOGIC: Agar screenshot hai, toh seedha Gemini se plan banwao
        if (image && genAI) {
            sendEvent('log', { agent: "Vision Engine", status: "Scanning Image", details: "Extracting UI components from screenshot..." });
            const geminiVisionModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash", generationConfig: { responseMimeType: "application/json" } });
            
            const imagePart = { inlineData: { data: image.split(',')[1], mimeType: image.split(';')[0].split(':')[1] } };
            const visionPrompt = `Analyze this UI screenshot. User request: "${finalPrompt}". Return ONLY JSON with tech stack, files needed, and dependencies. Format: { "tech_stack": "...", "files_needed": ["index.html", "styles.css"], "dependencies": [] }`;
            
            const visionRes = await geminiVisionModel.generateContent([visionPrompt, imagePart]);
            masterData = extractJson(visionRes.response.text());
        } else {
            // Normal Prompt Logic
            const masterPrompt = `You are the Omni-Language Master. Request: "${finalPrompt}". Return ONLY JSON: { "tech_stack": "...", "files_needed": ["src/App.jsx"], "dependencies": ["axios"] }`;
            try {
                const masterRes = await groq.chat.completions.create({ messages: [{ role: 'system', content: masterPrompt }], model: MASTER_MODEL, temperature: 0.1, response_format: { type: 'json_object' } });
                masterData = JSON.parse(masterRes.choices[0].message.content);
            } catch (e) {
                const backupMaster = await safeGenerate(masterPrompt, true);
                masterData = extractJson(backupMaster.text);
            }
        }

        const techStack = masterData?.tech_stack || "React";
        const filesToGenerate = masterData?.files_needed || ["src/App.jsx"];
        sendEvent('log', { agent: "System Architect", status: "Stack Locked", details: `Generating ${filesToGenerate.length} files.` });

        // 🧠 PROJECT MEMORY: Purane files ka data stringify karke memory me daalo
        let memoryString = "";
        if (contextFiles && Object.keys(contextFiles).length > 0) {
            memoryString = "\n\n[PROJECT MEMORY - EXISTING FILES:\n";
            for (const [fname, fcode] of Object.entries(contextFiles)) {
                // Memory bachane ke liye code ko thoda chota karke bhejenge
                memoryString += `--- ${fname} ---\n${fcode.substring(0, 1500)}...\n`; 
            }
            memoryString += "]\nCRITICAL: Ensure your new code connects flawlessly with these existing files!";
        }

        for (const filename of filesToGenerate) {
            try {
                sendEvent('log', { agent: `${techStack} Dev`, status: "Deep Coding", details: `Writing logic for ${filename}...` });
                
                // Worker ko Prompt ke sath Memory bhi bheji jayegi
                const workerPrompt = `You are an Elite Developer. Context: "${finalPrompt}". ${memoryString}
                🚨 CRITICAL: YOU ARE ONLY WRITING CODE FOR ${filename}. Return ONLY the raw functional code. NO MARKDOWN.`;
                
                const generatedData = await safeGenerate(workerPrompt, false, sendEvent); 
                let currentCode = cleanRawCode(generatedData.text);
                
                // File generate hone ke baad purane workspace me save hogi
                const absoluteFilePath = path.join(WORKSPACE_DIR, filename);
                await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true });
                await fs.writeFile(absoluteFilePath, currentCode);

                sendEvent('file', { filename: filename, code: currentCode });
                sendEvent('log', { agent: `${generatedData.engine} Worker`, status: "File Generated", details: `${filename} successfully written.` });

            } catch (fileError) {
                sendEvent('log', { agent: "System Crash", status: "Error", details: `Failed on ${filename}.` });
            }
        }

        sendEvent('log', { agent: "Deployment Manager", status: "Success", details: `Project built perfectly!` });
        sendEvent('done', { success: true });
        res.end();

    } catch (error) {
        sendEvent('error', { error: `Swarm Error: ${error.message}` });
        res.end();
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running...`));
