const express = require('express');
const cors = require('cors');
require('dotenv').config();

const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Mistral } = require('@mistralai/mistralai');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/env', (req, res) => {
    res.json({ success: true, variables: { MANTU_AI_STATUS: "30-AGENT TRI-ENGINE SWARM ACTIVE" } });
});

app.post('/api/build', async (req, res) => {
    const { prompt } = req.body;
    console.log(`\n[🚀 Mantu AI Swarm Initiated]: ${prompt.substring(0, 30)}...`);

    let masterAgentLogs = [];
    let masterFiles = {};

    // ==========================================
    // 🧠 1. GEMINI (Planning Department)
    // ==========================================
    try {
        if (process.env.GEMINI_API_KEY) {
            console.log(`[1/3] Calling Gemini API...`);
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            // Safe stable model string that never 404s
            const geminiModel = genAI.getGenerativeModel({ model: "gemini-pro" }); 

            const geminiPrompt = `You are the Planning Department of Mantu AI. Task: "${prompt}". Generate exactly 5 agent logs outlining the planning phase (Architecture, Features). Return ONLY a JSON object with a "logs" array. Format: { "logs": [ { "agent": "Product Manager", "status": "Defining Scope", "details": "..." } ] }`;

            const geminiResult = await geminiModel.generateContent(geminiPrompt);
            let cleanText = geminiResult.response.text().replace(/```(json)?/gi, '').replace(/```/g, '').trim();
            const geminiData = JSON.parse(cleanText);
            masterAgentLogs = [...masterAgentLogs, ...(geminiData.logs || [])];
        } else {
            masterAgentLogs.push({ agent: "System", status: "Warning", details: "Gemini Key missing." });
        }
    } catch (error) {
        console.error("Gemini Error:", error.message);
        masterAgentLogs.push({ agent: "Gemini System", status: "API Failed", details: error.message });
    }

    // ==========================================
    // ⚡ 2. GROQ (Frontend Department)
    // ==========================================
    try {
        if (process.env.GROQ_API_KEY) {
            console.log(`[2/3] Calling Groq API...`);
            const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

            const groqPrompt = `You are the Frontend Department of Mantu AI. Task: "${prompt}". 
            Generate exactly 5 agent logs for frontend work, and the FULL React code files.

            CRITICAL CODING RULES:
            1. DO NOT MINIFY THE CODE! 
            2. You MUST use actual newline characters ('\\n') and proper indentation in the code strings.
            3. Return ONLY valid JSON. No markdown tags.

            Format: { "logs": [ { "agent": "UI Designer", "status": "Styling", "details": "..." } ], "files": { "src/App.jsx": "import React from 'react';\\n\\nexport default function App() {\\n  return <div>Hello</div>;\\n}" } }`;

            const groqResult = await groq.chat.completions.create({
                messages: [{ role: 'system', content: groqPrompt }],
                model: 'llama-3.3-70b-versatile',
                temperature: 0.1,
                response_format: { type: 'json_object' }
            });
            const groqData = JSON.parse(groqResult.choices[0].message.content);
            masterAgentLogs = [...masterAgentLogs, ...(groqData.logs || [])];
            masterFiles = { ...masterFiles, ...(groqData.files || {}) };
        } else {
            masterAgentLogs.push({ agent: "System", status: "Warning", details: "Groq Key missing." });
        }
    } catch (error) {
        console.error("Groq Error:", error.message);
        masterAgentLogs.push({ agent: "Groq System", status: "API Failed", details: error.message });
    }

    // ==========================================
    // 🛡️ 3. MISTRAL (Backend & QA Department)
    // ==========================================
    try {
        if (process.env.MISTRAL_API_KEY) {
            console.log(`[3/3] Calling Mistral API...`);
            const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
            const mistralPrompt = `You are the Backend & QA Department of Mantu AI. Task: "${prompt}". Generate exactly 2 logs for Setup and Security. Generate config files with PROPER NEWLINES (\\n), DO NOT MINIFY. Return ONLY valid JSON. Format: { "logs": [ { "agent": "Security Lead", "status": "Testing", "details": "..." } ], "files": { "tailwind.config.js": "..." } }`;

            const mistralResult = await mistral.chat.complete({
                model: 'mistral-large-latest',
                messages: [{ role: 'user', content: mistralPrompt }],
                temperature: 0.1,
                responseFormat: { type: 'json_object' }
            });
            const mistralData = JSON.parse(mistralResult.choices[0].message.content);
            masterAgentLogs = [...masterAgentLogs, ...(mistralData.logs || [])];
            masterFiles = { ...masterFiles, ...(mistralData.files || {}) };
        } else {
            masterAgentLogs.push({ agent: "System", status: "Warning", details: "Mistral Key missing." });
        }
    } catch (error) {
        console.error("Mistral Error:", error.message);
        masterAgentLogs.push({ agent: "Mistral System", status: "API Failed", details: error.message });
    }

    // ==========================================
    // 🎯 FINAL ASSEMBLY & SAFETY CHECK
    // ==========================================
    console.log(`[Swarm Complete] Agents Deployed: ${masterAgentLogs.length}. Files: ${Object.keys(masterFiles).length}`);

    if (Object.keys(masterFiles).length === 0) {
        return res.json({ 
            success: false, 
            error: "All APIs failed. Please check your API Keys in Render Dashboard.",
            logs: masterAgentLogs,
            files: { "SystemLog.txt": "// All API calls failed. No files generated." }
        });
    }

    res.json({ success: true, logs: masterAgentLogs, files: masterFiles });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}...`));
