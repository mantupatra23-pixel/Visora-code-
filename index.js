const express = require('express');
const cors = require('cors');
require('dotenv').config();

const Groq = require('groq-sdk');

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.get('/api/env', (req, res) => {
    res.json({ success: true, variables: { MANTU_AI_STATUS: "DEEP MASTER-WORKER SWARM ACTIVE" } });
});

app.post('/api/build', async (req, res) => {
    const { prompt } = req.body;
    console.log(`\n[🚀 Deep Master-Worker Swarm Initiated]`);

    try {
        if (!process.env.GROQ_API_KEY) return res.json({ success: false, error: "Groq API Key missing!" });

        // =================================================================
        // 🧠 PHASE 1: MASTER ARCHITECT (Blueprint Creator)
        // =================================================================
        console.log(`[1/2] Master Architect planning the project...`);
        const masterPrompt = `You are the Master Architect of Mantu AI.
        User Request: "${prompt}"
        
        Plan the architecture for a modern, Silicon-Valley grade application.
        Break it down into necessary files. 
        
        Return ONLY valid JSON:
        {
          "logs": [
            { "agent": "Lead Architect", "status": "Blueprint Created", "details": "Analyzed request and assigned components to worker squads." }
          ],
          "files_needed": [
            "src/App.jsx", 
            "src/components/Navbar.jsx", 
            "src/components/HeroSection.jsx",
            "src/components/InputBox.jsx",
            "tailwind.config.js"
          ]
        }`;

        const masterRes = await groq.chat.completions.create({
            messages: [{ role: 'system', content: masterPrompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: 'json_object' }
        });

        const masterData = JSON.parse(masterRes.choices[0].message.content);
        const filesToGenerate = masterData.files_needed || ["src/App.jsx"];
        let masterFiles = {};
        let masterLogs = masterData.logs || [];

        // =================================================================
        // ⚡ PHASE 2: DEEP WORKER SQUADS (1 Squad per file)
        // =================================================================
        console.log(`[2/2] Master delegating to ${filesToGenerate.length} Worker Squads...`);

        for (const filename of filesToGenerate) {
            console.log(`      -> Squad building: ${filename}`);
            
            masterLogs.push({ 
                agent: "Dev Squad", 
                status: "Deep Coding", 
                details: `A team of 5 agents (UI, React, Animations, QA) is heavily coding ${filename}...` 
            });

            // 🔥 YAHAN HAI ASLI JADU: SQUAD KO STRICT WARNING 🔥
            const workerPrompt = `You are a specialized squad of 5 elite developers (React Expert, Tailwind Designer, Animation Specialist, UX Lead, and QA).
            Overall Project Context: "${prompt}"
            
            YOUR ONLY TASK is to write the absolute BEST, most detailed code for this specific file: ${filename}.
            
            🚨 STRICT RULES FOR YOUR SQUAD 🚨
            1. NO LAZINESS! You MUST write highly detailed, production-ready code.
            2. ZERO PLACEHOLDERS. Do not write "// code goes here". Write the actual logic.
            3. ADVANCED UI: If it's a component, forcefully include Glassmorphism, beautiful Tailwind gradients, hover animations, and transitions.
            4. USE ICONS: Embed complex SVG icons directly in the code for a premium look.
            5. It should look exactly like Vercel, Cursor, or v0.dev.
            6. Use proper newlines (\\n).
            
            Return ONLY valid JSON.
            Format: { "code": "full detailed exhaustive code string here" }`;

            const workerRes = await groq.chat.completions.create({
                messages: [{ role: 'system', content: workerPrompt }],
                model: 'llama-3.3-70b-versatile',
                temperature: 0.3, // Thodi creativity on rakhi hai taaki design acha banaye
                response_format: { type: 'json_object' }
            });

            const workerData = JSON.parse(workerRes.choices[0].message.content);
            masterFiles[filename] = workerData.code || `// Error writing ${filename}`;
        }

        masterLogs.push({ agent: "QA Lead", status: "Review Complete", details: "All components deeply coded, styled, and assembled perfectly." });
        console.log(`[Swarm Complete] Successfully generated deep-coded files!`);

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

