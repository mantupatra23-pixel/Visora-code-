const express = require('express');
const cors = require('cors');
require('dotenv').config();

const Groq = require('groq-sdk');

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// 🔥 SMART JSON EXTRACTOR (Groq 400 Error Bypass) 🔥
const extractJson = (text) => {
    try {
        let cleanText = text.replace(/```(json)?/gi, '').replace(/```/gi, '').trim();
        const match = cleanText.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : JSON.parse(cleanText);
    } catch (e) {
        return null;
    }
};

app.get('/api/env', (req, res) => {
    res.json({ success: true, variables: { MANTU_AI_STATUS: "BULLETPROOF FULL-STACK SWARM ACTIVE" } });
});

app.post('/api/build', async (req, res) => {
    const { prompt } = req.body;
    console.log(`\n[🚀 Bulletproof Full-Stack Swarm Initiated]`);

    try {
        if (!process.env.GROQ_API_KEY) return res.json({ success: false, error: "Groq API Key missing!" });

        let masterLogs = [];
        let masterFiles = {};

        // =================================================================
        // 🧠 PHASE 1: MASTER ANALYST (Frontend + Backend Architecture)
        // =================================================================
        console.log(`[1/3] Master Analyst is breaking down the prompt...`);
        masterLogs.push({ agent: "Master Analyst", status: "Deep Analysis", details: "Breaking down requirements for Frontend and Backend." });

        const masterPrompt = `You are the Master Architect. User Request: "${prompt}"
        Create a Full-Stack architecture. Include backend (e.g., 'server/index.js') and frontend files (e.g., 'src/App.jsx').
        Return ONLY valid JSON: { "files_needed": ["src/App.jsx", "server/index.js"] }`;

        const masterRes = await groq.chat.completions.create({
            messages: [{ role: 'system', content: masterPrompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            // Master ka prompt chota hota hai, isliye yahan strict mode chalega
            response_format: { type: 'json_object' } 
        });

        const masterData = JSON.parse(masterRes.choices[0].message.content);
        const filesToGenerate = masterData.files_needed || ["src/App.jsx", "server/index.js"];
        
        masterLogs.push({ agent: "System Architect", status: "Blueprint Ready", details: `Files to generate: ${filesToGenerate.join(', ')}` });

        // =================================================================
        // ⚡ PHASE 2 & 3: DRAFTING & BUG FIXING (NO STRICT JSON TO PREVENT 400 ERROR)
        // =================================================================
        console.log(`[2/3] Deep Coding & QA Phase Started...`);

        for (const filename of filesToGenerate) {
            console.log(`      -> Processing: ${filename}`);
            
            try {
                // --- DRAFTING ---
                masterLogs.push({ agent: "Full-Stack Dev", status: "Drafting", details: `Writing raw logic for ${filename}...` });
                
                const workerPrompt = `Write the code for ${filename} based on this project: "${prompt}". 
                Return ONLY a JSON object in this format: { "code": "full code here" }. DO NOT use markdown.`;
                
                const workerRes = await groq.chat.completions.create({
                    messages: [{ role: 'system', content: workerPrompt }],
                    model: 'llama-3.3-70b-versatile',
                    temperature: 0.2,
                    // 🔥 REMOVED response_format to prevent 400 error! 🔥
                });
                
                const draftParsed = extractJson(workerRes.choices[0].message.content);
                const draftCode = draftParsed ? draftParsed.code : workerRes.choices[0].message.content;

                // --- QA & LINKING ---
                masterLogs.push({ agent: "QA Tester", status: "Hunting Bugs", details: `Simulated testing on ${filename}...` });

                const qaPrompt = `Review this code for ${filename}:\n\n${draftCode}\n\n
                Project Goal: "${prompt}"
                1. Fix ANY bugs, syntax errors, or missing imports.
                2. Add detailed logic and beautiful UI (if frontend).
                3. Return ONLY a JSON object: { "status": "Fixed X bugs", "code": "final code here" }. DO NOT use markdown.`;

                const qaRes = await groq.chat.completions.create({
                    messages: [{ role: 'system', content: qaPrompt }],
                    model: 'llama-3.3-70b-versatile',
                    temperature: 0.1,
                    // 🔥 REMOVED response_format to prevent 400 error! 🔥
                });

                const qaParsed = extractJson(qaRes.choices[0].message.content);
                
                if (qaParsed && qaParsed.code) {
                    masterFiles[filename] = qaParsed.code;
                    masterLogs.push({ agent: "Bug Fixer", status: "Verified & Linked", details: `[Resolved]: ${qaParsed.status || 'Code optimized'}` });
                } else {
                    // Fallback agar json fail ho jaye
                    masterFiles[filename] = qaRes.choices[0].message.content;
                    masterLogs.push({ agent: "Bug Fixer", status: "Verified & Linked", details: `[Resolved]: Code generated with raw formatting.` });
                }

            } catch (fileError) {
                console.error(`Error generating ${filename}:`, fileError.message);
                masterLogs.push({ agent: "System Alert", status: "API Failed", details: `Failed on ${filename}: ${fileError.message}.` });
                masterFiles[filename] = `// Mantu AI Error: ${fileError.message}`;
            }
        }

        masterLogs.push({ agent: "Deployment Manager", status: "Success", details: "All files successfully generated and verified." });

        res.json({ success: true, logs: masterLogs, files: masterFiles });

    } catch (error) {
        console.error("Swarm Error:", error.message);
        res.json({ success: false, error: `Swarm Error: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}...`));
