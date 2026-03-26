const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.get('/api/env', (req, res) => {
    const maskedVars = {};
    Object.keys(process.env).forEach(key => {
        const value = process.env[key];
        if (key.includes('KEY') || key.includes('PORT') || key.includes('URL')) {
            maskedVars[key] = value ? `${value.substring(0, 4)}••••••••` : 'NOT DEFINED';
        }
    });
    res.json({ success: true, variables: maskedVars });
});

app.post('/api/build', async (req, res) => {
    const { prompt } = req.body;
    console.log(`\n[🚀 Mantu AI Swarm Initiated]: ${prompt.substring(0, 30)}...`);

    try {
        if (!process.env.GROQ_API_KEY) return res.json({ success: false, error: "API Key missing!" });

        // 🔥 THE STRICT MILITARY-STYLE PROMPT 🔥
        const systemPrompt = `You are the Mantu AI Swarm, an elite team of 5 software engineering agents.
        The user's request is: "${prompt}"
        
        AGENT ROLES:
        1. Requirements Analyst: Breaks down core features.
        2. System Architect: Decides the exact file structure.
        3. UI/UX Designer: Decides Tailwind styling and theme.
        4. State Manager: Plans React hooks and component logic.
        5. Senior Developer: Writes the FINAL, COMPLETE CODE for ALL files.

        ⚠️ CRITICAL RULES FOR CODE GENERATION (IF YOU BREAK THESE, THE SYSTEM DIES) ⚠️
        1. NO SHORTCUTS! You MUST write every single line of code. NEVER use placeholders like "// code goes here" or "// logic here". Write the full, working component.
        2. NO MINIFICATION! You MUST format the code beautifully. Use actual newline characters ('\\n') and tabs ('\\t') inside your JSON string so the code is vertical and readable. Do NOT put everything on one line.
        3. Return ONLY a valid JSON object. DO NOT wrap the JSON in markdown blocks (no \`\`\`json).

        EXPECTED JSON FORMAT:
        {
          "agent_logs": [
            { "agent": "Requirements Analyst", "status": "Analyzed request...", "details": "..." },
            { "agent": "System Architect", "status": "Designed Architecture...", "details": "..." },
            { "agent": "UI/UX Designer", "status": "Finalized Design System...", "details": "..." },
            { "agent": "State Manager", "status": "Planned Data Flow...", "details": "..." },
            { "agent": "Senior Developer", "status": "Code Generation Complete", "details": "Successfully generated all fully-functional files." }
          ],
          "files": {
            "src/App.jsx": "import React from 'react';\\n\\nexport default function App() {\\n  return (\\n    <div className=\\"min-h-screen bg-black\\">\\n      <h1>Hello World</h1>\\n    </div>\\n  );\\n}",
            "src/components/Navbar.jsx": "import React from 'react';\\n\\nexport default function Navbar() {\\n  return <nav className=\\"p-4\\">Nav</nav>;\\n}"
          }
        }`;

        const completion = await groq.chat.completions.create({
            messages: [{ role: 'system', content: systemPrompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1, // Keep it low so the AI follows rules strictly
            response_format: { type: 'json_object' }
        });

        const resultJSON = JSON.parse(completion.choices[0].message.content);
        console.log(`[Swarm Complete] Generated ${Object.keys(resultJSON.files || {}).length} files.`);

        res.json({ 
            success: true, 
            logs: resultJSON.agent_logs,
            files: resultJSON.files 
        });

    } catch (error) {
        console.error("Mantu Engine Error:", error.message);
        res.json({ success: false, error: `AI Error: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Mantu 5-Agent Strict Backend Live! 🚀"));
app.listen(process.env.PORT || 3000, () => console.log("Server running..."));
