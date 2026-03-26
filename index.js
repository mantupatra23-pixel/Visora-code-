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
    console.log(`\n[🚀 Mantu AI Started]: ${prompt.substring(0, 30)}...`);

    try {
        if (!process.env.GROQ_API_KEY) return res.json({ success: false, error: "API Key missing!" });

        // ==========================================
        // 🧠 AGENT 1: THE ARCHITECT (Analysis)
        // ==========================================
        console.log(`[Agent 1] Analyzing and planning files...`);
        const agent1Prompt = `You are Mantu AI Architect. Analyze this app idea: "${prompt}".
        Decide which React component files need to be created (e.g., App.jsx, Navbar.jsx, Dashboard.jsx).
        Return ONLY a JSON object exactly in this format:
        {
          "analysis": "Brief 2-sentence explanation of the architecture",
          "files_to_create": ["src/App.jsx", "src/components/Header.jsx"]
        }`;

        const completion1 = await groq.chat.completions.create({
            messages: [{ role: 'system', content: agent1Prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: 'json_object' } // FORCES OUTPUT TO BE JSON
        });

        const planJSON = JSON.parse(completion1.choices[0].message.content);
        console.log(`[Agent 1] Plan Ready:`, planJSON.files_to_create);

        // ==========================================
        // 💻 AGENT 2: THE CODER (File-by-File Gen)
        // ==========================================
        console.log(`[Agent 2] Writing code for ${planJSON.files_to_create.length} files...`);
        const agent2Prompt = `You are Mantu AI Coder. Based on the app idea: "${prompt}".
        Write the FULL, flawless React code for the following files: ${JSON.stringify(planJSON.files_to_create)}.
        Use Tailwind CSS for styling.
        Return ONLY a JSON object where keys are file paths and values are the raw code strings.
        DO NOT USE MARKDOWN IN THE CODE STRINGS. USE PROPER NEWLINES (\\n).
        Format:
        {
          "src/App.jsx": "import React from 'react';\\n\\nexport default function App() {\\n  return <div>...</div>;\\n}",
          "src/components/Header.jsx": "..."
        }`;

        const completion2 = await groq.chat.completions.create({
            messages: [{ role: 'system', content: agent2Prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: 'json_object' } // FORCES OUTPUT TO BE JSON
        });

        const codeJSON = JSON.parse(completion2.choices[0].message.content);
        console.log(`[Agent 2] Code generation complete!`);

        // Send both Analysis and Files to Frontend
        res.json({ 
            success: true, 
            analysis: planJSON.analysis,
            files: codeJSON 
        });

    } catch (error) {
        console.error("Mantu Engine Error:", error.message);
        res.json({ success: false, error: `AI Error: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Mantu Multi-Agent Backend Live! 🚀"));
app.listen(process.env.PORT || 3000, () => console.log("Server running..."));
