const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));

app.get('/', (req, res) => res.send("ENGINE STATUS: ONLINE (8GB RAM MODE)"));

app.post('/build', async (req, res) => {
    const { modName, generated_files } = req.body;
    const logs = [];
    const log = (msg) => { logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`); console.log(msg); };

    if (!generated_files) return res.status(400).json({ success: false, error: 'No files provided' });

    const tmpDir = path.join(os.tmpdir(), `build-${Date.now()}`);
    
    try {
        await fs.ensureDir(tmpDir);
        log("Workspace ready. Writing files...");

        for (const [name, content] of Object.entries(generated_files)) {
            const p = path.join(tmpDir, name);
            await fs.ensureDir(path.dirname(p));
            await fs.writeFile(p, content);
        }

        log("Launching Gradle build (Limit: 6GB RAM)...");
        
        // הגדרת הזיכרון ל-6GB
        const child = spawn('gradle', ['build', '--no-daemon'], {
            cwd: tmpDir,
            env: { 
                ...process.env, 
                GRADLE_OPTS: "-Xmx6g -Xms1g" // מתחיל מ-1GB ויכול לעלות עד 6GB
            }
        });

        child.stdout.on('data', (d) => log(d.toString()));
        child.stderr.on('data', (d) => log(`ERROR: ${d.toString()}`));

        child.on('close', async (code) => {
            if (code !== 0) {
                log(`Build failed with code ${code}`);
                return res.status(500).json({ success: false, error: 'Build Failed', logs });
            }

            const libsDir = path.join(tmpDir, 'build/libs');
            const files = await fs.readdir(libsDir);
            const jar = files.find(f => f.endsWith('.jar') && !f.includes('-dev'));

            if (!jar) return res.status(500).json({ success: false, error: 'JAR not found', logs });

            const jarBuffer = await fs.readFile(path.join(libsDir, jar));
            const manifest = { files: Object.keys(generated_files), status: "PASS" };

            res.json({
                success: true,
                jar_base64: jarBuffer.toString('base64'),
                file_name: jar,
                manifest: manifest,
                logs
            });

            await fs.remove(tmpDir).catch(() => {});
        });
    } catch (err) {
        log(`CRITICAL: ${err.message}`);
        res.status(500).json({ success: false, error: err.message, logs });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Heavy-Duty Server listening on ${PORT}`));
