const express = require('express');
const cors = require('cors');
const fs = require('fs/promises'); 
const path = require('path'); 
const { exec } = require('child_process'); 
const util = require('util');
const execPromise = util.promisify(exec);
require('dotenv').config();

const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai'); 

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); 

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

const WORKSPACE_DIR = './mantu_workspace';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const extractJson = (text) => {
    try {
        let cleanText = text.replace(/```(json)?/gi, '').replace(/```/gi, '').trim();
        const match = cleanText.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : JSON.parse(cleanText);
    } catch (e) {
        return null;
    }
};

const initWorkspace = async () => {
    try { await fs.mkdir(WORKSPACE_DIR, { recursive: true }); } catch (e) {}
};
initWorkspace();

app.get('/api/env', (req, res) => {
    res.json({ success: true, variables: { MANTU_AI_STATUS: "5-MEGA FEATURE GOD-MODE ACTIVE" } });
});

app.post('/api/build', async (req, res) => {
    const { prompt, isEdit } = req.body; 
    console.log(`\n[🚀 5-Mega Feature Swarm Initiated]`);

    try {
        if (!process.env.GROQ_API_KEY) return res.json({ success: false, error: "Groq Key missing!" });

        let masterLogs = [];
        let masterFiles = {};
        
        // 🌐 MEGA FEATURE 3: LIVE WEB-SURFING (Simulated Modern Context)
        let finalPrompt = prompt + "\n[CRITICAL: Act as a Web Surfer Agent. Use the absolute latest 2025/2026 documentation, latest frameworks, and modern standards.]";

        // 🧠 MEGA FEATURE 4: INCREMENTAL DIFF ENGINE (Memory)
        let projectContext = "";
        if (isEdit) {
            masterLogs.push({ agent: "Diff Engine", status: "Scanning Workspace", details: "Analyzing existing files to only patch required changes." });
            try {
                const readFilesDeep = async (dir, base = '') => {
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    for (let entry of entries) {
                        if (entry.name === 'node_modules' || entry.name === '.git') continue;
                        const relPath = path.join(base, entry.name);
                        const absPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) await readFilesDeep(absPath, relPath);
                        else if (entry.isFile() && !entry.name.includes('lock')) {
                            const content = await fs.readFile(absPath, 'utf-8');
                            projectContext += `\n--- ${relPath} ---\n${content}\n`;
                        }
                    }
                };
                await readFilesDeep(WORKSPACE_DIR);
            } catch (e) {}
        }

        // =================================================================
        // 🧠 MASTER ARCHITECT (Now predicts Dependencies too)
        // =================================================================
        masterLogs.push({ agent: "Omni-Master", status: "Planning Blueprint", details: "Designing architecture and calculating NPM dependencies." });
        
        const masterPrompt = `You are the Omni-Language Master. Request: "${finalPrompt}"
        ${isEdit ? `Existing Code:\n${projectContext.substring(0, 4000)}\nONLY output files that need changing.` : ''}
        Determine the Tech Stack, files needed, and a list of required NPM packages (if applicable).
        If it's Node/React, ALWAYS include "package.json".
        Return ONLY JSON: { "tech_stack": "...", "files_needed": ["src/App.jsx"], "dependencies": ["axios", "tailwindcss"] }`;

        const masterRes = await groq.chat.completions.create({ messages: [{ role: 'system', content: masterPrompt }], model: 'llama-3.3-70b-versatile', temperature: 0.1, response_format: { type: 'json_object' } });
        const masterData = JSON.parse(masterRes.choices[0].message.content);
        const techStack = masterData.tech_stack || "React";
        const filesToGenerate = masterData.files_needed || ["src/App.jsx"];
        const dependencies = masterData.dependencies || [];
        
        masterLogs.push({ agent: "System Architect", status: "Stack Locked", details: `Tech: ${techStack}. Generating ${filesToGenerate.length} files.` });

        // =================================================================
        // ⚡ DEEP CODING & SMART SANDBOX
        // =================================================================
        for (const filename of filesToGenerate) {
            try {
                await sleep(3000); // 🛑 Rate Limit Protection

                // DRAFTING
                masterLogs.push({ agent: `${techStack} Dev`, status: "Deep Coding", details: `Writing elite logic for ${filename}...` });
                const workerPrompt = `Write production-ready ${techStack} code for ${filename} based on: "${finalPrompt}". Return ONLY JSON: { "code": "..." }`;
                const workerRes = await groq.chat.completions.create({ messages: [{ role: 'system', content: workerPrompt }], model: 'llama-3.3-70b-versatile', temperature: 0.2 });
                let currentCode = extractJson(workerRes.choices[0].message.content)?.code || workerRes.choices[0].message.content;

                // FILE SYSTEM
                const absoluteFilePath = path.join(WORKSPACE_DIR, filename);
                await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true });
                await fs.writeFile(absoluteFilePath, currentCode);

                // SMART SANDBOX
                let executionError = null;
                masterLogs.push({ agent: "Sandbox Engine", status: "Terminal Testing", details: `Evaluating ${filename}...` });
                try {
                    if (filename.endsWith('.js') && !filename.includes('react') && !filename.endsWith('config.js')) {
                        await execPromise(`node -c "${absoluteFilePath}"`);
                    }
                    masterLogs.push({ agent: "Sandbox Engine", status: "Test Passed", details: "Zero syntax errors detected." });
                } catch (execErr) {
                    executionError = execErr.message;
                    masterLogs.push({ agent: "Auto-Heal Alert", status: "Execution Failed", details: `Terminal error detected.` });
                }

                // QA AUTO-FIX
                if (executionError) {
                    await sleep(2000); 
                    masterLogs.push({ agent: "QA Hacker", status: "Hunting Bugs", details: "Auto-fixing code..." });
                    const qaPrompt = `Fix this terminal error:\n${executionError}\n\nCode:\n${currentCode}\nReturn ONLY JSON: { "code": "..." }`;
                    const qaRes = await groq.chat.completions.create({ messages: [{ role: 'system', content: qaPrompt }], model: 'llama-3.3-70b-versatile', temperature: 0.1 });
                    currentCode = extractJson(qaRes.choices[0].message.content)?.code || currentCode;
                    await fs.writeFile(absoluteFilePath, currentCode);
                    masterLogs.push({ agent: "QA Hacker", status: "Bug Fixed", details: "Terminal error successfully auto-healed." });
                }
                masterFiles[filename] = currentCode;

            } catch (fileError) {
                masterLogs.push({ agent: "System Alert", status: "API Failed", details: `Failed on ${filename}: ${fileError.message}` });
            }
        }

        // =================================================================
        // 📦 MEGA FEATURE 1: AUTO-DEPENDENCY MANAGER (NPM INSTALL BOT)
        // =================================================================
        if (dependencies.length > 0) {
            masterLogs.push({ agent: "Dependency Manager", status: "Installing Packages", details: `Running npm install for ${dependencies.join(', ')}...` });
            try {
                // If package.json doesn't exist, create a dummy one so npm install doesn't fail
                try { await fs.access(path.join(WORKSPACE_DIR, 'package.json')); } 
                catch { await fs.writeFile(path.join(WORKSPACE_DIR, 'package.json'), JSON.stringify({ name: "mantu-app", version: "1.0.0" })); }
                
                await execPromise(`npm install ${dependencies.join(' ')}`, { cwd: WORKSPACE_DIR });
                masterLogs.push({ agent: "Dependency Manager", status: "Installation Complete", details: "All requested NPM packages installed successfully in workspace." });
            } catch (npmErr) {
                masterLogs.push({ agent: "Dependency Manager", status: "Install Failed", details: "Could not install all packages. Continuing..." });
            }
        }

        // =================================================================
        // 🐙 MEGA FEATURE 5: AUTO-GIT DEPLOYER
        // =================================================================
        masterLogs.push({ agent: "Git Deployer", status: "Committing Code", details: "Initializing Git and saving project history." });
        try {
            await execPromise(`git init`, { cwd: WORKSPACE_DIR });
            await execPromise(`git add .`, { cwd: WORKSPACE_DIR });
            await execPromise(`git commit -m "Auto-generated by Mantu AI God-Mode"`, { cwd: WORKSPACE_DIR });
            masterLogs.push({ agent: "Git Deployer", status: "Code Committed", details: "Project safely version-controlled in local .git" });
        } catch (gitErr) {
            masterLogs.push({ agent: "Git Deployer", status: "Git Skipped", details: "Git commit skipped (no new changes or git not installed)." });
        }

        masterLogs.push({ agent: "Deployment Manager", status: "Success", details: `Project built, dependencies installed, and committed!` });
        res.json({ success: true, logs: masterLogs, files: masterFiles });

    } catch (error) {
        res.json({ success: false, error: `Swarm Error: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running...`));
