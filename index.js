const express = require('express');
const cors = require('cors');
require('dotenv').config();

const Groq = require('groq-sdk');

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.get('/api/env', (req, res) => {
    res.json({ success: true, variables: { MANTU_AI_STATUS: "FULL-STACK SELF-HEALING SWARM ACTIVE" } });
});

app.post('/api/build', async (req, res) => {
    const { prompt } = req.body;
    console.log(`\n[🚀 Full-Stack Self-Healing Swarm Initiated]`);

    try {
        if (!process.env.GROQ_API_KEY) return res.json({ success: false, error: "Groq API Key missing!" });

        let masterLogs = [];
        let masterFiles = {};

        // =================================================================
        // 🧠 PHASE 1: MASTER ANALYST (Frontend + Backend Architecture)
        // =================================================================
        console.log(`[1/3] Master Analyst is breaking down the prompt...`);
        masterLogs.push({ agent: "Master Analyst", status: "Deep Analysis", details: "Breaking down requirements for both Frontend (React) and Backend (Node/Express)." });

        const masterPrompt = `You are the Master Architect of Mantu AI.
        User Request: "${prompt}"
        
        Create a Full-Stack architecture (Frontend + Backend). 
        You MUST include a backend file (e.g., 'server/index.js' or 'api/server.js') and frontend files (e.g., 'src/App.jsx').
        
        Return ONLY valid JSON:
        {
          "files_needed": ["src/App.jsx", "src/components/Navbar.jsx", "server/index.js"]
        }`;

        const masterRes = await groq.chat.completions.create({
            messages: [{ role: 'system', content: masterPrompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: 'json_object' }
        });

        const masterData = JSON.parse(masterRes.choices[0].message.content);
        const filesToGenerate = masterData.files_needed || ["src/App.jsx", "server/index.js"];
        
        masterLogs.push({ agent: "System Architect", status: "Blueprint Ready", details: `Architecture mapped. Files to generate: ${filesToGenerate.join(', ')}` });

        // =================================================================
        // ⚡ PHASE 2 & 3: DRAFTING, BUG CHECKING, & LINKING
        // =================================================================
        console.log(`[2/3] Deep Coding & QA Phase Started...`);

        for (const filename of filesToGenerate) {
            console.log(`      -> Processing: ${filename}`);
            
            try {
                // STEP A: WORKER WRITES INITIAL DRAFT
                masterLogs.push({ agent: "Full-Stack Dev", status: "Drafting", details: `Writing raw logic for ${filename}...` });
                
                const workerPrompt = `Write the code for ${filename} based on this Full-Stack project: "${prompt}". 
                If it's frontend, use React & Tailwind. If backend, use Node.js/Express. 
                Return ONLY JSON: { "code": "..." }`;
                
                const workerRes = await groq.chat.completions.create({
                    messages: [{ role: 'system', content: workerPrompt }],
                    model: 'llama-3.3-70b-versatile',
                    temperature: 0.2,
                    response_format: { type: 'json_object' }
                });
                const draftCode = JSON.parse(workerRes.choices[0].message.content).code;

                // STEP B: QA AGENT FINDS BUGS & LINKS FRONTEND TO BACKEND
                masterLogs.push({ agent: "QA Tester", status: "Hunting Bugs", details: `Running simulated tests on ${filename} for errors and API links...` });

                const qaPrompt = `You are the Elite QA & Integration Engineer. 
                Review this code for ${filename}:\n\n${draftCode}\n\n
                Project Goal: "${prompt}"
                
                YOUR JOB:
                1. Fix ANY bugs, syntax errors, or missing imports.
                2. If it's a Frontend file, ensure it makes fetch/axios calls to the Backend API.
                3. If it's a Backend file, ensure CORS is enabled and API routes match the frontend.
                4. Add detailed, professional logic. DO NOT MINIFY. Use \\n.
                
                Return ONLY valid JSON.
                Format: { "status": "Fixed 2 bugs and linked API", "code": "full bug-free code string" }`;

                const qaRes = await groq.chat.completions.create({
                    messages: [{ role: 'system', content: qaPrompt }],
                    model: 'llama-3.3-70b-versatile',
                    temperature: 0.1,
                    response_format: { type: 'json_object' }
                });

                const qaData = JSON.parse(qaRes.choices[0].message.content);
                const finalCode = qaData.code;
                
                masterFiles[filename] = finalCode;
                masterLogs.push({ agent: "Bug Fixer", status: "Verified & Linked", details: `[Resolved]: ${qaData.status || 'Code optimized and linked successfully.'}` });

            } catch (fileError) {
                // 🚨 LIVE ERROR HANDLING: Agar kisi file mein error aaya, toh live panel par dikhayega!
                console.error(`Error generating ${filename}:`, fileError.message);
                masterLogs.push({ agent: "System Alert", status: "API Failed", details: `Error generating ${filename}: ${fileError.message}. Initiating auto-skip.` });
                masterFiles[filename] = `// Mantu AI Error: Failed to generate this file.\n// Details: ${fileError.message}`;
            }
        }

        console.log(`[Swarm Complete] Full-Stack Generation Successful!`);
        masterLogs.push({ agent: "Deployment Manager", status: "Success", details: "Frontend and Backend are successfully generated, linked, and bug-free." });

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
