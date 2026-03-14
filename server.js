const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process'); // שינוי ל-Async
const os = require('os');

const app = express();
app.use(express.json({ limit: '50mb' }));

const LOCKED_PKG = 'buildmeamod';
const GRADLE_CACHE = path.join(os.tmpdir(), '.gradle-cache');
fs.ensureDirSync(GRADLE_CACHE);

app.get('/', (req, res) => res.json({ status: 'Online' }));

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

        // בדיקה קריטית: האם קבצי התשתית קיימים לפני שמתחילים?
        const infrastructure = ['gradlew', 'gradle', 'build.gradle', 'settings.gradle', 'gradle.properties'];
        for (const file of infrastructure) {
            const src = path.join(__dirname, file);
            if (!(await fs.pathExists(src))) {
                throw new Error(`Critical infrastructure file missing: ${file} at ${src}`);
            }
            await fs.copy(src, path.join(tmpDir, file));
        }

        if (process.platform !== 'win32') {
            await fs.chmod(path.join(tmpDir, 'gradlew'), '755');
        }

        // יצירת מבנה תיקיות (קוצר בשביל הפוסט)
        const javaBase = path.join(tmpDir, 'src/main/java/com', LOCKED_PKG);
        await fs.ensureDir(path.join(javaBase, 'registry'));
        
        // כתיבת קבצים
        for (const [name, content] of Object.entries(generated_files)) {
            const destPath = name.endsWith('.java') ? path.join(javaBase, name) : path.join(tmpDir, name);
            await fs.ensureDir(path.dirname(destPath));
            await fs.writeFile(destPath, content);
        }

        log('Starting Gradle build process...');

        // הרצה אסינכרונית כדי לא לתקוע את השרת
        const child = spawn('./gradlew', ['build', '--no-daemon'], {
            cwd: tmpDir,
            env: { 
                ...process.env, 
                GRADLE_OPTS: "-Xmx512m", // הורדתי ל-512MB כדי למנוע קריסה בשרתים חלשים
                GRADLE_USER_HOME: GRADLE_CACHE 
            }
        });

        child.stdout.on('data', (data) => log(`STDOUT: ${data}`));
        child.stderr.on('data', (data) => log(`STDERR: ${data}`));

        child.on('close', async (code) => {
            if (code !== 0) {
                return res.status(500).json({ success: false, error: 'Build Failed', logs });
            }

            const libsDir = path.join(tmpDir, 'build/libs');
            const jarFiles = (await fs.readdir(libsDir)).filter(f => f.endsWith('.jar') && !f.includes('-dev'));

            if (jarFiles.length === 0) {
                return res.status(500).json({ error: 'JAR not found', logs });
            }

            const jarBuffer = await fs.readFile(path.join(libsDir, jarFiles[0]));
            res.json({
                success: true,
                jar_base64: jarBuffer.toString('base64'),
                logs
            });

            // ניקוי
            await fs.remove(tmpDir);
        });

    } catch (err) {
        log(`FATAL: ${err.message}`);
        res.status(500).json({ error: err.message, logs });
    }
});

app.listen(process.env.PORT || 8080, '0.0.0.0');
