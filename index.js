const express = require('express');
const cors = require('cors');
require('dotenv').config();

const Groq = require('groq-sdk');

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.get('/api/env', (req, res) => {
    res.json({ success: true, variables: { MANTU_AI_STATUS: "TRUE MASTER-WORKER SWARM ACTIVE" } });
});

app.post('/api/build', async (req, res) => {
    const { prompt } = req.body;
    console.log(`\n[🚀 True Master-Worker Swarm Initiated]`);

    try {
        if (!process.env.GROQ_API_KEY) {
            return res.json({ success: false, error: "Groq API Key missing!" });
        }

        // =================================================================
        // 🧠 PHASE 1: MASTER ARCHITECT (Decides structure and logs)
        // =================================================================
        console.log(`[1/2] Master Architect is planning the project...`);
        const masterPrompt = `You are the Master Architect of Mantu AI.
        User Request: "${prompt}"

        Your ONLY job is to plan the architecture and decide which files are needed.

        Return ONLY valid JSON in this exact format:
        {
          "logs": [
            { "agent": "Lead Architect", "status": "Planning", "details": "Designed component structure..." },
            { "agent": "Security Lead", "status": "Auditing", "details": "Checked requirements..." }
          ],
          "files_needed": [
            "src/App.jsx", 
            "src/components/Navbar.jsx", 
            "src/components/HeroSection.jsx",
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

        // =================================================================
        // ⚡ PHASE 2: WORKER AGENTS (Focuses heavily on ONE file at a time)
        // =================================================================
        console.log(`[2/2] Master delegating ${filesToGenerate.length} files to Worker Agents...`);

        // Hum ek-ek karke file banwayenge taaki AI detail mein code likhe
        for (const filename of filesToGenerate) {
            console.log(`      -> Worker Agent writing: ${filename}`);

            const workerPrompt = `You are an Elite Senior React & Tailwind Developer.
            Project Context: "${prompt}"

            Your ONLY task is to write the FULL, PRODUCTION-READY code for this specific file: ${filename}.

            CRITICAL RULES:
            1. DO NOT BE LAZY! Write EVERY SINGLE LINE of the code. 
            2. DO NOT use placeholders like "// Add logic here".
            3. Apply beautiful Tailwind CSS, glassmorphism, animations, and gradients as requested.
            4. Use proper newlines (\\n).

            Return ONLY valid JSON.
            Format: { "code": "full code string here" }`;

            const workerRes = await groq.chat.completions.create({
                messages: [{ role: 'system', content: workerPrompt }],
                model: 'llama-3.3-70b-versatile',
                temperature: 0.2, // Thodi creativity ke liye 0.2
                response_format: { type: 'json_object' }
            });

            const workerData = JSON.parse(workerRes.choices[0].message.content);
            masterFiles[filename] = workerData.code || `// Error writing ${filename}`;
        }

        console.log(`[Swarm Complete] Successfully generated deep-coded files!`);

        res.json({ 
            success: true, 
            logs: masterData.logs || [], 
            files: masterFiles 
        });

    } catch (error) {
        console.error("Swarm Error:", error.message);
        res.json({ success: false, error: `Swarm Error: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}...`));
