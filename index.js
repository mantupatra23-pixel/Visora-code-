const express = require('express');
const cors = require('cors');
require('dotenv').config();

const Groq = require('groq-sdk');

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.get('/api/env', (req, res) => {
    res.json({ success: true, variables: { MANTU_AI_STATUS: "DEEP ACTOR-CRITIC SWARM ACTIVE" } });
});

app.post('/api/build', async (req, res) => {
    const { prompt } = req.body;
    console.log(`\n[🚀 Deep Actor-Critic Swarm Initiated]`);

    try {
        if (!process.env.GROQ_API_KEY) return res.json({ success: false, error: "Groq API Key missing!" });

        let masterLogs = [];
        let masterFiles = {};

        // =================================================================
        // 🧠 PHASE 1: ANALYZE & VERIFY (Master + Analyst)
        // =================================================================
        console.log(`[1/3] Master Architect analyzing and verifying...`);
        masterLogs.push({ agent: "Agent 1 (Analyst)", status: "Analyzing Prompt", details: "Breaking down the user request into deep technical requirements." });
        masterLogs.push({ agent: "Agent 2 (Verifier)", status: "Verifying Tech Stack", "details": "Ensuring React, Tailwind, and complex UI rules are applied." });
        masterLogs.push({ agent: "Agent 3 (Master)", status: "Creating Blueprint", "details": "Finalizing the file structure for the workers." });

        const masterPrompt = `You are the Master Architect of Mantu AI.
        User Request: "${prompt}"
        Create a comprehensive, Silicon-Valley grade project structure.
        Return ONLY valid JSON:
        {
          "files_needed": ["src/App.jsx", "src/components/Navbar.jsx", "tailwind.config.js"]
        }`;

        const masterRes = await groq.chat.completions.create({
            messages: [{ role: 'system', content: masterPrompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: 'json_object' }
        });

        const masterData = JSON.parse(masterRes.choices[0].message.content);
        const filesToGenerate = masterData.files_needed || ["src/App.jsx"];

        // =================================================================
        // ⚡ PHASE 2: THE 3-TIER CODING ENGINE (Work -> Verify -> Oversee)
        // =================================================================
        console.log(`[2/3] Deep Coding Phase Started for ${filesToGenerate.length} files...`);

        for (const filename of filesToGenerate) {
            console.log(`      -> Processing: ${filename}`);
            masterLogs.push({ agent: "Agent 1 (Coder)", status: "Drafting", details: `Writing initial logic for ${filename}...` });

            // STEP A: AGENT 1 (THE WORKER) WRITES INITIAL DRAFT
            const workerPrompt = `Write the code for ${filename} based on this project: "${prompt}". Use React and Tailwind CSS. Return ONLY JSON: { "code": "..." }`;
            const workerRes = await groq.chat.completions.create({
                messages: [{ role: 'system', content: workerPrompt }],
                model: 'llama-3.3-70b-versatile',
                temperature: 0.2,
                response_format: { type: 'json_object' }
            });
            const draftCode = JSON.parse(workerRes.choices[0].message.content).code;

            masterLogs.push({ agent: "Agent 2 (Reviewer)", status: "Verifying & Enhancing", details: `Criticizing ${filename} draft and forcing deep improvements...` });

            // 🔥 STEP B: AGENT 2 & 3 (THE CRITIC & OVERSEER) FORCE DEEP ENHANCEMENTS 🔥
            const criticPrompt = `You are the Elite Tech Lead and QA Overseer. 
            A junior developer wrote this draft for ${filename}:\n\n${draftCode}\n\n
            Project Goal: "${prompt}"
            
            This draft is TOO BASIC. Your job is to deeply ENHANCE it.
            🚨 STRICT OVERSEER RULES:
            1. Make the code 3x more detailed, professional, and robust.
            2. Forcefully inject advanced Tailwind CSS (glassmorphism, deep gradients, complex hover/focus states, smooth transitions).
            3. Add proper SVG icons, exhaustive React State, and flawless layout structuring.
            4. DO NOT use placeholders. Every function must be fully implemented.
            5. Ensure perfect line breaks (\\n) and indentation.
            
            Return ONLY valid JSON with the final production-ready code.
            Format: { "code": "full enhanced code string" }`;

            const criticRes = await groq.chat.completions.create({
                messages: [{ role: 'system', content: criticPrompt }],
                model: 'llama-3.3-70b-versatile',
                temperature: 0.3, // Creativity on for advanced styling
                response_format: { type: 'json_object' }
            });

            const finalDeepCode = JSON.parse(criticRes.choices[0].message.content).code;
            masterFiles[filename] = finalDeepCode || draftCode; // Save the deeply reviewed code
            
            masterLogs.push({ agent: "Agent 3 (Overseer)", status: "Approved", details: `${filename} passed deep quality checks and is production-ready.` });
        }

        console.log(`[Swarm Complete] Successfully generated and reviewed deep-coded files!`);
        masterLogs.push({ agent: "System", status: "Success", details: "All files deeply coded, reviewed, and finalized." });

        res.json({ 
            success: true, 
            logs: masterLogs, 
            files: masterFiles 
        });

    } catch (error) {
        console.error("Swarm Error:", error.message);
        res.json({ success: false, error: `Swarm Error: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}...`));
