const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const cors = require('cors');

const app = express();

// הגדרות תקשורת לפרויקטים כבדים
app.use(cors());
app.use(express.json({ limit: '150mb' }));

// הגדרת מטמון Gradle להאצת בנייה (בתיקייה זמנית)
const GRADLE_CACHE = path.join(os.tmpdir(), '.gradle-cache');
fs.ensureDirSync(GRADLE_CACHE);

app.get('/', (req, res) => {
    res.status(200).send("<h1>MOD BUILDER ENGINE v3.0 (8GB RAM MODE)</h1><p>Status: ONLINE</p>");
});

app.post('/build', async (req, res) => {
    // 1. הגדרת משתנים ראשונית (כדי למנוע ReferenceError)
    const { modName, generated_files, projectId } = req.body;
    const logs = [];
    const log = (msg) => {
        const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
        logs.push(entry);
        console.log(entry);
    };

    if (!generated_files || Object.keys(generated_files).length === 0) {
        return res.status(400).json({ success: false, error: 'No source files provided' });
    }

    const modId = (modName || 'mod').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const tmpDir = path.join(os.tmpdir(), `build-${Date.now()}-${modId}`);

    try {
        log(`--- Starting Build for Project: ${modId} ---`);
        log(`RAM Allocation: 6GB for Gradle.`);
        
        // 2. יצירת סביבת העבודה
        await fs.ensureDir(tmpDir);
        log(`Workspace created at: ${tmpDir}`);

        // 3. פריסת קבצים (כולל טיפול בטקסטורות ודירוג נתיבים)
        log(`Writing ${Object.keys(generated_files).length} files...`);
        for (let [filePath, content] of Object.entries(generated_files)) {
            // ניקוי נתיבים (הסרת סלאש תחילתי אם קיים)
            if (filePath.startsWith('/')) filePath = filePath.substring(1);
            const dest = path.join(tmpDir, filePath);
            
            await fs.ensureDir(path.dirname(dest));
            
           if (typeof content === 'string' && content.startsWith('data:image')) {
    const buffer = Buffer.from(content.split(',')[1], 'base64');
    await fs.writeFile(dest, buffer);
} else if (typeof content === 'string' && content.startsWith('http')) {
    try {
        const https = require('https');
        const http = require('http');
        const client = content.startsWith('https') ? https : http;
        await new Promise((resolve, reject) => {
            client.get(content, (response) => {
                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('end', async () => {
                    await fs.writeFile(dest, Buffer.concat(chunks));
                    resolve();
                });
                response.on('error', reject);
            }).on('error', reject);
        });
    } catch(e) {
        console.warn(`Failed to download texture: ${content}`);
        await fs.writeFile(dest, content);
    }
} else {
    await fs.writeFile(dest, content);
}
        }

        // 4. בדיקת תקינות Gradle Build
        if (!(await fs.pathExists(path.join(tmpDir, 'build.gradle')))) {
            log("CRITICAL ERROR: build.gradle is missing in the source files!");
            return res.status(400).json({ 
                success: false, 
                error: 'Build failed: build.gradle not found in root.',
                logs: logs 
            });
        }

        log("Launching Gradle build process...");

        // 5. הרצת ה-Build (כאן קורה הקסם)
        const child = spawn('gradle', ['build', '--no-daemon'], {
            cwd: tmpDir,
            env: { 
                ...process.env, 
                GRADLE_OPTS: "-Xmx6g -Xms1g -Dorg.gradle.jvmargs=-Xmx6g",
                GRADLE_USER_HOME: GRADLE_CACHE 
            }
        });

        child.stdout.on('data', (data) => log(data.toString().trim()));
        child.stderr.on('data', (data) => log(`[GRADLE-ERR] ${data.toString().trim()}`));

        child.on('close', async (code) => {
            log(`Gradle process finished with code ${code}`);

            if (code !== 0) {
                log("ERROR: Build process failed. See logs above.");
                return res.status(500).json({ success: false, error: 'Gradle Build Failed', logs });
            }

            // 6. איתור וקידוד ה-JAR
            const libsDir = path.join(tmpDir, 'build/libs');
            if (!(await fs.pathExists(libsDir))) {
                return res.status(500).json({ success: false, error: 'Output directory missing', logs });
            }

            const outputFiles = await fs.readdir(libsDir);
            const finalJar = outputFiles.find(f => f.endsWith('.jar') && !f.includes('-dev') && !f.includes('-sources'));

            if (!finalJar) {
                return res.status(500).json({ success: false, error: 'JAR file not found in build/libs', logs });
            }

            log(`Final JAR produced: ${finalJar}`);
            const jarBuffer = await fs.readFile(path.join(libsDir, finalJar));

            // 7. יצירת המניפסט לצ'קליסט באתר
            const manifest = {
                status: "PASS",
                filesCount: Object.keys(generated_files).length,
                buildDate: new Date().toISOString(),
                files: Object.keys(generated_files)
            };

            // 8. שליחת התוצאה המלאה
            res.json({
                success: true,
                jar_base64: jarBuffer.toString('base64'),
                file_name: finalJar,
                manifest: manifest,
                logs: logs
            });

            // ניקוי תיקייה זמנית
            await fs.remove(tmpDir).catch(e => console.error("Cleanup failed:", e));
            log(`Build directory ${tmpDir} cleaned up.`);
        });

    } catch (err) {
        log(`CRITICAL ERROR: ${err.message}`);
        res.status(500).json({ success: false, error: err.message, logs });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`================================================`);
    console.log(`HEAVY-DUTY BUILD ENGINE READY ON PORT ${PORT}`);
    console.log(`MEMORY LIMIT: 6GB GRADLE / 8GB SYSTEM`);
    console.log(`================================================`);
});
