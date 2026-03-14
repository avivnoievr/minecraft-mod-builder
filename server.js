const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const app = express();
app.use(express.json({ limit: '50mb' }));
const cors = require('cors');
app.use(cors()); // זה מאפשר לכל אתר (כולל Base44) לדבר עם השרת שלך

const LOCKED_PKG = 'buildmeamod';
const GRADLE_CACHE = path.join(os.tmpdir(), '.gradle-cache');
fs.ensureDirSync(GRADLE_CACHE);

app.get('/', (req, res) => res.json({ status: 'Online', engine: 'Gradle-Global' }));

app.post('/build', async (req, res) => {
    const { modName, generated_files } = req.body;
    const logs = [];
    const log = (msg) => {
        const entry = `[${new Date().toISOString()}] ${msg}`;
        logs.push(entry);
        console.log(entry);
    };

    if (!generated_files || !modName) {
        return res.status(400).json({ error: 'Missing data' });
    }

    const modId = modName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const tmpDir = path.join(os.tmpdir(), `build-${Date.now()}`);

    try {
        log(`Initializing build for: ${modId}`);
        await fs.ensureDir(tmpDir);

        // --- שלב א': יצירת מבנה תיקיות ---
        const javaBase = path.join(tmpDir, 'src/main/java/com', LOCKED_PKG);
        const resBase = path.join(tmpDir, 'src/main/resources');
        
        await fs.ensureDir(path.join(javaBase, 'registry'));
        await fs.ensureDir(path.join(resBase, 'assets', modId));

        // --- שלב ב': כתיבת קבצים מה-generated_files ---
        for (const [name, content] of Object.entries(generated_files)) {
            // התאמת נתיבים: אם זה קובץ Java, נשים אותו בתיקיית המקור
            let destPath;
            if (name.endsWith('.java')) {
                destPath = path.join(javaBase, name === 'Main.java' ? '' : 'registry', name);
            } else {
                destPath = path.join(tmpDir, name);
            }
            
            await fs.ensureDir(path.dirname(destPath));
            await fs.writeFile(destPath, content);
        }

        log('Starting Global Gradle build process...');

        // --- שלב ג': הרצת Gradle המותקן ב-Dockerfile ---
        const child = spawn('gradle', ['build', '--no-daemon'], {
            cwd: tmpDir,
            env: {
                ...process.env,
                GRADLE_OPTS: "-Xmx1024m -Xms512m",
                GRADLE_USER_HOME: GRADLE_CACHE
            }
        });

        child.stdout.on('data', (data) => log(`[GRADLE] ${data}`));
        child.stderr.on('data', (data) => log(`[ERROR] ${data}`));

        child.on('close', async (code) => {
            if (code !== 0) {
                return res.status(500).json({ success: false, error: `Gradle exited with code ${code}`, logs });
            }

            const libsDir = path.join(tmpDir, 'build/libs');
            if (!(await fs.pathExists(libsDir))) {
                return res.status(500).json({ error: 'Build directory not found', logs });
            }

            const files = await fs.readdir(libsDir);
            const jarFile = files.find(f => f.endsWith('.jar') && !f.includes('-dev') && !f.includes('-sources'));

            if (!jarFile) {
                return res.status(500).json({ error: 'No valid JAR found', logs });
            }

            const jarBuffer = await fs.readFile(path.join(libsDir, jarFile));
            res.json({
                success: true,
                file_name: jarFile,
                jar_base64: jarBuffer.toString('base64'),
                logs
            });

            // ניקוי תיקייה זמנית
            await fs.remove(tmpDir).catch(e => console.error('Cleanup failed:', e));
        });

    } catch (err) {
        log(`FATAL: ${err.message}`);
        if (tmpDir) await fs.remove(tmpDir).catch(() => {});
        res.status(500).json({ error: err.message, logs });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Server listening on port ${PORT}`));
