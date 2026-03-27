const express = require('express');
const cors = require('cors');
const fs = require('fs/promises'); 
const path = require('path'); 
require('dotenv').config();

const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai'); 

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Vision Image ke liye badi limit

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null; 

const WORKSPACE_DIR = './mantu_workspace';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Models
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

// 🔥 THE GPU-FIRST ENGINE 🔥
async function safeGenerate(promptText, isJson = true, sendEvent = null) {
    
    // 🥇 Tier 1: AAPKA APNA AWS GPU SERVER (Nvidia A10G)
    try {
        const awsApiUrl = process.env.AWS_API_URL || "http://34.229.98.123:8000/chat";
        const finalUrl = `${awsApiUrl}?prompt=${encodeURIComponent(promptText + (isJson ? " MUST RETURN JSON." : " RAW CODE ONLY."))}`;
        
        if(sendEvent) sendEvent('log', { agent: "AWS GPU Engine", status: "Computing", details: "Llama-3 processing on Nvidia A10G..." });

        // ⏱️ Timeout 120 Seconds kar diya taaki bada code kate nahi
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); 

        const awsRes = await fetch(finalUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": process.env.AWS_API_PASSWORD || "mantu_godmode_secure_999" },
            signal: controller.signal 
        });
        clearTimeout(timeoutId); 

        if (!awsRes.ok) throw new Error("AWS Server Unreachable");
        const awsData = await awsRes.json();
        
        if(awsData.error) throw new Error(awsData.error);
        return { text: awsData.response, engine: "AWS Llama-3 GPU" };
        
    } catch (awsErr) {
        if(sendEvent) sendEvent('log', { agent: "System Router", status: "Switching", details: `AWS Failed/Busy. Switching to Groq...` });

        // 🥈 Tier 2: Groq Backup
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
            
            if(sendEvent) sendEvent('log', { agent: "System Router", status: "Switching", details: `Groq Down. Moving to Gemini...` });

            // 🥉 Tier 3: Gemini Backup
            try {
                if (!genAI) throw new Error("Gemini Key Missing");
                const geminiModel = genAI.getGenerativeModel({ model: GEMINI_WORKER, generationConfig: isJson ? { responseMimeType: "application/json" } : {} });
                const res = await geminiModel.generateContent(promptText);
                return { text: res.response.text(), engine: "Gemini" };
            } catch (geminiErr) {
                throw new Error("ALL ENGINES FAILED"); 
            }
        }
    }
}

app.get('/api/env', (req, res) => res.json({ success: true, variables: { MANTU_AI_STATUS: "GPU VISION + MEMORY ENGINE ACTIVE" } }));

app.post('/api/build', async (req, res) => {
    const { prompt, image, contextFiles } = req.body; 

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const sendEvent = (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

    try {
        let finalPrompt = prompt + "\n[CRITICAL: Use modern standards.]";
        let masterData;

        sendEvent('log', { agent: "Omni-Master", status: "Planning Blueprint", details: "Analyzing request..." });

        // 👁️ VISION ENGINE (Screenshot to Code)
        if (image && genAI) {
            sendEvent('log', { agent: "Vision Engine", status: "Scanning Image", details: "Extracting UI layout from screenshot..." });
            const geminiVisionModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash", generationConfig: { responseMimeType: "application/json" } });
            
            const imagePart = { inlineData: { data: image.split(',')[1], mimeType: image.split(';')[0].split(':')[1] } };
            const visionPrompt = `Analyze this UI screenshot. User request: "${finalPrompt}". Return ONLY JSON with tech stack, files needed, and dependencies. Format: { "tech_stack": "...", "files_needed": ["index.html", "styles.css"], "dependencies": [] }`;
            
            const visionRes = await geminiVisionModel.generateContent([visionPrompt, imagePart]);
            masterData = extractJson(visionRes.response.text());
        } else {
            // NORMAL MASTER PLANNER
            const masterPrompt = `You are the Omni-Language Master. Request: "${finalPrompt}". Return ONLY JSON: { "tech_stack": "...", "files_needed": ["index.html"], "dependencies": [] }`;
            try {
                const masterRes = await groq.chat.completions.create({ messages: [{ role: 'system', content: masterPrompt }], model: MASTER_MODEL, temperature: 0.1, response_format: { type: 'json_object' } });
                masterData = JSON.parse(masterRes.choices[0].message.content);
            } catch (e) {
                const backupMaster = await safeGenerate(masterPrompt, true);
                masterData = extractJson(backupMaster.text);
            }
        }

        const techStack = masterData?.tech_stack || "HTML/CSS/JS";
        const filesToGenerate = masterData?.files_needed || ["index.html"];
        sendEvent('log', { agent: "System Architect", status: "Stack Locked", details: `Generating ${filesToGenerate.length} files.` });

        // 🧠 PROJECT MEMORY (Purana code naye code se link karna)
        let memoryString = "";
        if (contextFiles && Object.keys(contextFiles).length > 0) {
            memoryString = "\n\n[PROJECT MEMORY - EXISTING FILES:\n";
            for (const [fname, fcode] of Object.entries(contextFiles)) {
                memoryString += `--- ${fname} ---\n${fcode.substring(0, 1500)}...\n`; 
            }
            memoryString += "]\nCRITICAL: Ensure your new code connects flawlessly with these existing files!";
        }

        for (const filename of filesToGenerate) {
            try {
                sendEvent('log', { agent: `${techStack} Dev`, status: "Deep Coding", details: `Writing logic for ${filename}...` });
                
                const workerPrompt = `You are an Elite Developer. Context: "${finalPrompt}". ${memoryString}
                🚨 CRITICAL: YOU ARE ONLY WRITING CODE FOR ${filename}. Return ONLY the raw functional code. NO MARKDOWN.`;
                
                const generatedData = await safeGenerate(workerPrompt, false, sendEvent); 
                let currentCode = cleanRawCode(generatedData.text);
                
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
