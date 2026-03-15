const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// הגדרת תיקיית מטמון ל-Gradle כדי להאיץ בנייה
const GRADLE_CACHE = path.join(os.tmpdir(), '.gradle-cache');
fs.ensureDirSync(GRADLE_CACHE);

app.get('/', (req, res) => res.send("MOD BUILDER SYSTEM: ONLINE"));

app.post('/build', async (req, res) => {
    const { modName, generated_files } = req.body;
    const logs = [];
    const log = (msg) => {
        const entry = `[${new Date().toISOString()}] ${msg}`;
        logs.push(entry);
        console.log(entry);
    };

    if (!generated_files || Object.keys(generated_files).length === 0) {
        return res.status(400).json({ success: false, error: 'No files provided' });
    }

    const modId = (modName || 'mod').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const tmpDir = path.join(os.tmpdir(), `build-${Date.now()}`);

    try {
        log(`Starting production build for: ${modId}`);
        await fs.ensureDir(tmpDir);

        // 1. כתיבת הקבצים לתיקייה הזמנית
        for (const [name, content] of Object.entries(generated_files)) {
            const destPath = path.join(tmpDir, name);
            await fs.ensureDir(path.dirname(destPath));
            await fs.writeFile(destPath, content);
        }

        log('Launching Gradle...');

        // 2. הרצת פקודת ה-Build
        const child = spawn('gradle', ['build', '--no-daemon'], {
            cwd: tmpDir,
            env: { ...process.env, GRADLE_OPTS: "-Xmx1024m", GRADLE_USER_HOME: GRADLE_CACHE }
        });

        child.stdout.on('data', (data) => log(data.toString()));
        child.stderr.on('data', (data) => log(`ERR: ${data.toString()}`));

        child.on('close', async (code) => {
            log(`Gradle finished with code ${code}`);
            
            if (code !== 0) {
                return res.status(500).json({ success: false, error: 'Build failed', logs });
            }

            const libsDir = path.join(tmpDir, 'build/libs');
            if (!(await fs.pathExists(libsDir))) {
                return res.status(500).json({ success: false, error: 'Output directory not found', logs });
            }

            const files = await fs.readdir(libsDir);
            const jar = files.find(f => f.endsWith('.jar') && !f.includes('-dev') && !f.includes('-sources'));

            if (!jar) {
                return res.status(500).json({ success: false, error: 'JAR not found', logs });
            }

            // 3. קריאת הקובץ והפיכה ל-Base64
            const jarBuffer = await fs.readFile(path.join(libsDir, jar));

            // 4. יצירת מניפסט (זה מה שיתקן את הצ'קליסט האדום באתר)
            const manifest = {
                files: Object.keys(generated_files),
                buildTime: new Date().toISOString(),
                status: "PASS"
            };

            log('Success! Sending JAR and manifest back to site.');
            res.json({
                success: true,
                jar_base64: jarBuffer.toString('base64'),
                file_name: jar,
                manifest: manifest,
                logs: logs
            });

            // ניקוי תיקייה זמנית
            await fs.remove(tmpDir).catch(() => {});
        });

    } catch (err) {
        log(`CRITICAL ERROR: ${err.message}`);
        res.status(500).json({ success: false, error: err.message, logs });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Server listening on port ${PORT}`));
