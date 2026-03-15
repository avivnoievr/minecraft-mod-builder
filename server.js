const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const cors = require('cors');

/**
 * מנוע בנייה למודים של מיינקראפט - גרסת High-Performance
 * מותאם לשרת עם 8GB RAM ומערכת Base44
 */

const app = express();

// הגדרות אבטחה ותקשורת
app.use(cors());
app.use(express.json({ limit: '150mb' })); // תמיכה בפרויקטים כבדים עם טקסטורות

// ניהול זיכרון ומטמון - שימוש בתיקייה זמנית של המערכת
const GRADLE_CACHE = path.join(os.tmpdir(), '.gradle-cache');
fs.ensureDirSync(GRADLE_CACHE);

app.get('/', (req, res) => {
    res.status(200).send(`
        <h1>Mod Builder Engine Status: ONLINE</h1>
        <p>Memory Mode: 8GB Optimized</p>
        <p>System Time: ${new Date().toISOString()}</p>
    `);
});

app.post('/build', async (req, res) => {
    const { modName, generated_files, projectId } = req.body;
    const logs = [];
    
    // פונקציית לוג פנימית שמתעדת כל שלב במיקרו-שניות
    const log = (msg) => {
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const logEntry = `[${timestamp}] ${msg}`;
        logs.push(logEntry);
        console.log(logEntry);
    };

    // שלב 1: פריסת הקבצים
        log(`מתחיל כתיבת ${Object.keys(generated_files).length} קבצים למערכת הקבצים...`);
        for (let [filePath, content] of Object.entries(generated_files)) {
            
            // תיקון נתיבים: אם הנתיב מתחיל ב- / נוריד אותו
            if (filePath.startsWith('/')) filePath = filePath.substring(1);
            
            const dest = path.join(tmpDir, filePath);
            await fs.ensureDir(path.dirname(dest));
            
            if (typeof content === 'string' && content.startsWith('data:image')) {
                const base64Data = content.split(',')[1];
                await fs.writeFile(dest, Buffer.from(base64Data, 'base64'));
            } else {
                await fs.writeFile(dest, content);
            }
        }

        // בדיקה קריטית: האם build.gradle קיים?
        if (!(await fs.pathExists(path.join(tmpDir, 'build.gradle')))) {
            log("CRITICAL ERROR: build.gradle missing in workspace!");
            // בוא נבדוק אם הוא נמצא בטעות בתיקיית משנה
            const allFiles = Object.keys(generated_files);
            log(`Available files: ${allFiles.join(', ')}`);
            return res.status(400).json({ success: false, error: 'build.gradle not found in root', logs });
        }

    // יצירת סביבת עבודה מבודדת
    const modId = (modName || 'mod').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const buildTag = `build-${Date.now()}-${modId}`;
    const tmpDir = path.join(os.tmpdir(), buildTag);

    try {
        log(`יצירת תיקיית עבודה זמנית בנתיב: ${tmpDir}`);
        await fs.ensureDir(tmpDir);

        // שלב 1: פריסת הקבצים
        log(`מתחיל כתיבת ${Object.keys(generated_files).length} קבצים למערכת הקבצים...`);
        for (const [relativeUrl, content] of Object.entries(generated_files)) {
            const fullPath = path.join(tmpDir, relativeUrl);
            await fs.ensureDir(path.dirname(fullPath));
            
            // זיהוי טקסטורות ב-Base64
            if (typeof content === 'string' && content.startsWith('data:image')) {
                const buffer = Buffer.from(content.split(',')[1], 'base64');
                await fs.writeFile(fullPath, buffer);
            } else {
                await fs.writeFile(fullPath, content);
            }
        }
        log("שלב כתיבת הקבצים הסתיים בהצלחה.");

        // שלב 2: הרצת Gradle
        log(`מפעיל Gradle Daemon... הקצאת זיכרון: 6GB RAM (מתוך 8GB זמינים).`);
        
        // הגדרות Gradle קריטיות למניעת קריסות ב-Cloud
        const gradleArgs = ['build', '--no-daemon', '--parallel', '--quiet'];
        const child = spawn('gradle', gradleArgs, {
            cwd: tmpDir,
            env: { 
                ...process.env, 
                // הקצאת 6GB ל-JVM כדי להשאיר 2GB למערכת ול-Node
                GRADLE_OPTS: "-Xmx6g -Xms1g -Dorg.gradle.jvmargs=-Xmx6g",
                GRADLE_USER_HOME: GRADLE_CACHE 
            }
        });

        child.stdout.on('data', (data) => {
            const output = data.toString().trim();
            if (output) log(`[GRADLE] ${output}`);
        });

        child.stderr.on('data', (data) => {
            const errOutput = data.toString().trim();
            if (errOutput) log(`[GRADLE-WARN] ${errOutput}`);
        });

        // טיפול בשגיאת "Command not found" - קורה אם ה-Dockerfile לא תקין
        child.on('error', (err) => {
            log(`FATAL: נכשל ניסיון הרצת פקודת Gradle. וודא שהיא מותקנת ב-Path. שגיאה: ${err.message}`);
            res.status(500).json({ success: false, error: "System environment error", logs });
        });

        child.on('close', async (code) => {
            log(`תהליך ה-Build הסתיים עם קוד יציאה: ${code}`);

            if (code !== 0) {
                log("ERROR: הבנייה נכשלה. ראה לוגים למעלה לפרטים על שגיאות סינטקס ב-Java.");
                return res.status(500).json({ 
                    success: false, 
                    error: 'Gradle build failed. Review build logs.', 
                    logs 
                });
            }

            // שלב 3: איתור התוצר הסופי (JAR)
            log("מבצע סריקה לאיתור קובץ ה-JAR שנוצר...");
            const libsDir = path.join(tmpDir, 'build/libs');
            
            if (!(await fs.pathExists(libsDir))) {
                log(`ERROR: תיקיית build/libs לא נוצרה. הבנייה כנראה לא הגיעה לסיומה.`);
                return res.status(500).json({ success: false, error: 'Output directory missing', logs });
            }

            const outputFiles = await fs.readdir(libsDir);
            const finalJar = outputFiles.find(f => f.endsWith('.jar') && !f.includes('-dev') && !f.includes('-sources'));

            if (!finalJar) {
                log("ERROR: לא נמצא קובץ JAR תקין בתיקיית הפלט.");
                return res.status(500).json({ success: false, error: 'JAR file not found', logs });
            }

            log(`נמצא תוצר: ${finalJar}. מתחיל קידוד להעברה...`);
            const jarBuffer = await fs.readFile(path.join(libsDir, finalJar));

            // שלב 4: יצירת מניפסט (זה מה שמתקן את ה-Checklist באתר)
            const manifest = {
                modId: modId,
                status: "PASS",
                filesIncluded: Object.keys(generated_files),
                totalFiles: Object.keys(generated_files).length,
                buildTimestamp: new Date().toISOString(),
                serverMemoryMode: "8GB_OPTIMIZED"
            };

            // שלב 5: תשובה סופית
            log("--- תהליך הבנייה הושלם בהצלחה! שולח נתונים לאתר ---");
            res.status(200).json({
                success: true,
                jar_base64: jarBuffer.toString('base64'),
                file_name: finalJar,
                manifest: manifest,
                logs: logs
            });

            // ניקוי תיקיות זמניות - כדי לא לסתום את הדיסק של Railway
            await fs.remove(tmpDir).catch(e => console.error("Cleanup error:", e));
        });

    } catch (err) {
        log(`CRITICAL SYSTEM ERROR: ${err.message}`);
        res.status(500).json({ success: false, error: err.message, logs });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ================================================
    BUILD ENGINE READY - 8GB RAM MODE ACTIVE
    PORT: ${PORT}
    ================================================
    `);
});
