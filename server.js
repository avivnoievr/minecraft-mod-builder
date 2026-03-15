const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const cors = require('cors');

const app = express();

// הגדרות בסיסיות - חובה עבור תקשורת עם Base44
app.use(cors());
app.use(express.json({ limit: '100mb' })); // תמיכה בקבצים גדולים במיוחד

// הגדרת נתיב זמני למטמון של Gradle - מונע הורדה מחדש של ספריות בכל פעם
const GRADLE_CACHE = path.join(os.tmpdir(), '.gradle-cache');
fs.ensureDirSync(GRADLE_CACHE);

// בדיקת דופק בסיסית
app.get('/', (req, res) => res.send("MINECRAFT MOD BUILDER ENGINE: READY"));

app.post('/build', async (req, res) => {
    const { modName, generated_files } = req.body;
    const logs = [];
    
    // פונקציית לוג מסודרת שנשלחת גם לאתר וגם לטרמינל
    const log = (msg) => {
        const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
        logs.push(entry);
        console.log(entry);
    };

    if (!generated_files || Object.keys(generated_files).length === 0) {
        return res.status(400).json({ success: false, error: 'No source files provided.' });
    }

    // יצירת מזהה ייחודי לבנייה
    const modId = (modName || 'mod').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const tmpDir = path.join(os.tmpdir(), `build-${Date.now()}-${modId}`);

    try {
        log(`--- Starting Build Process for: ${modId} ---`);
        await fs.ensureDir(tmpDir);

        // 1. כתיבת מבנה הפרויקט (Java, JSON, Textures)
        log(`Writing ${Object.keys(generated_files).length} files to workspace...`);
        for (const [filePath, content] of Object.entries(generated_files)) {
            const dest = path.join(tmpDir, filePath);
            await fs.ensureDir(path.dirname(dest));
            
            // טיפול בקבצים בינאריים (טקסטורות) אם נשלחו כ-Base64, אחרת כטקסט
            if (typeof content === 'string' && content.startsWith('data:image')) {
                const base64Data = content.split(',')[1];
                await fs.writeFile(dest, Buffer.from(base64Data, 'base64'));
            } else {
                await fs.writeFile(dest, content);
            }
        }

        log('Files ready. Launching Gradle daemon...');

        // 2. הרצת Gradle עם הגדרות אופטימליות ל-Railway
        // --no-daemon חוסך זיכרון, -Xmx1024m מגביל צריכת ראם
        const child = spawn('gradle', ['build', '--no-daemon'], {
            cwd: tmpDir,
            env: { 
                ...process.env, 
                GRADLE_OPTS: "-Xmx1024m -Dorg.gradle.jvmargs=-Xmx1024m",
                GRADLE_USER_HOME: GRADLE_CACHE 
            }
        });

        child.stdout.on('data', (data) => log(data.toString().trim()));
        child.stderr.on('data', (data) => log(`[GRADLE ERROR] ${data.toString().trim()}`));

        child.on('close', async (code) => {
            log(`Gradle process finished with exit code: ${code}`);

            if (code !== 0) {
                return res.status(500).json({ 
                    success: false, 
                    error: 'Gradle failed to compile the mod. Check logs for syntax errors.', 
                    logs 
                });
            }

            // 3. איתור קובץ ה-JAR שנוצר
            const libsDir = path.join(tmpDir, 'build/libs');
            if (!(await fs.pathExists(libsDir))) {
                return res.status(500).json({ success: false, error: 'Build output directory not found.', logs });
            }

            const files = await fs.readdir(libsDir);
            const jarFile = files.find(f => f.endsWith('.jar') && !f.includes('-dev') && !f.includes('-sources'));

            if (!jarFile) {
                return res.status(500).json({ success: false, error: 'JAR file was not generated.', logs });
            }

            log(`JAR found: ${jarFile}. Encoding for transfer...`);
            const jarBuffer = await fs.readFile(path.join(libsDir, jarFile));

            // 4. יצירת מניפסט מדויק (כדי לצבוע את הצ'קליסט באתר בירוק)
            const manifest = {
                modId: modId,
                buildStatus: "SUCCESS",
                timestamp: new Date().toISOString(),
                filesIncluded: Object.keys(generated_files),
                version: "1.0.0"
            };

            // 5. שליחת התשובה המלאה
            res.json({
                success: true,
                jar_base64: jarBuffer.toString('base64'),
                file_name: jarFile,
                manifest: manifest, // זה מה שיפתור את ה-"Files Missing"
                logs: logs
            });

            // ניקוי תיקייה זמנית בסיום
            await fs.remove(tmpDir).catch(err => console.error("Cleanup error:", err));
            log(`Cleanup complete for ${tmpDir}`);
        });

    } catch (err) {
        log(`FATAL ERROR: ${err.message}`);
        res.status(500).json({ success: false, error: err.message, logs });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(`MOD BUILDER ENGINE RUNNING ON PORT ${PORT}`);
    console.log(`=========================================`);
});
