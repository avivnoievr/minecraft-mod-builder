const express = require('express');
const { spawnSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

/**
 * Minecraft Mod Builder Server - Core Logic
 * Version: 2.1.0
 * Features: Gradle Wrapper sync, RAM optimization, detailed logging, auto-cleanup.
 */

const app = express();

// הגדלת מגבלת ה-Payload ל-50MB כדי לאפשר העברת קוד מורכב ומרקמים (Textures)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// משתני סביבה והגדרות קבועות
const PORT = process.env.PORT || 8080;
const GRADLE_CACHE_DIR = path.join(os.homedir(), '.gradle_cache');

// וידוא קיום תיקיית Cache ל-Gradle כדי להאיץ בנייה חוזרת
fs.ensureDirSync(GRADLE_CACHE_DIR);

/**
 * בדיקת תקינות בסיסית (Health Check)
 */
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'online',
        timestamp: new Date().toISOString(),
        service: 'Minecraft Mod Compiler'
    });
});

/**
 * נקודת הקצה המרכזית לבניית המוד
 */
app.post('/build', async (req, res) => {
    const { projectId, modName, generated_files } = req.body;
    
    // ניקוי שם המוד לשימוש בנתיבי קבצים
    const modId = (modName || 'mymod').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const buildSessionId = `build-${projectId || 'anon'}-${Date.now()}`;
    const tmpDir = path.join(os.tmpdir(), buildSessionId);
    
    const logs = [];
    const log = (msg) => {
        const entry = `[${new Date().toISOString()}] ${msg}`;
        logs.push(entry);
        console.log(entry);
    };

    try {
        log(`Initiating build sequence for Mod: ${modName} (ID: ${modId})`);

        // 1. הכנת סביבת העבודה
        log(`Creating workspace at: ${tmpDir}`);
        await fs.ensureDir(tmpDir);

        // 2. העתקת תשתית ה-Gradle מהשורש לתיקייה הזמנית
        // ללא הצעד הזה, הפקודה ./gradlew תיכשל כי היא לא קיימת בתיקייה הזמנית
        log('Synchronizing Gradle wrapper and build configuration...');
        const essentialFiles = [
            'gradlew',
            'gradle',
            'build.gradle',
            'settings.gradle',
            'gradle.properties'
        ];

        for (const file of essentialFiles) {
            const sourcePath = path.join(__dirname, file);
            if (await fs.pathExists(sourcePath)) {
                await fs.copy(sourcePath, path.join(tmpDir, file));
            } else {
                log(`CRITICAL WARNING: Essential file ${file} missing from server root!`);
            }
        }

        // מתן הרשאות הרצה ל-gradlew (נחוץ בשרתי Linux/Railway)
        if (process.platform !== 'win32') {
            log('Setting execution permissions for gradlew...');
            await fs.chmod(path.join(tmpDir, 'gradlew'), '755');
        }

        // 3. יצירת מבנה התיקיות של קוד המקור (Fabric/Forge Standard)
        const srcMainJava = path.join(tmpDir, 'src/main/java/com/buildmeamod');
        const resourcesDir = path.join(tmpDir, 'src/main/resources/assets', modId);
        
        await fs.ensureDir(path.join(srcMainJava, 'registry'));
        await fs.ensureDir(path.join(srcMainJava, 'item'));
        await fs.ensureDir(path.join(resourcesDir, 'textures/item'));
        await fs.ensureDir(path.join(resourcesDir, 'models/item'));

        // 4. כתיבת קבצי המקור שהתקבלו מה-Frontend
        log(`Writing ${Object.keys(generated_files).length} source files...`);
        for (const [fileName, content] of Object.entries(generated_files)) {
            let destination;
            
            if (fileName === 'Main') {
                destination = path.join(srcMainJava, 'Main.java');
            } else if (fileName.includes('Items') || fileName.includes('Blocks')) {
                destination = path.join(srcMainJava, 'registry', `${fileName}.java`);
            } else if (fileName.endsWith('.java')) {
                destination = path.join(srcMainJava, 'item', fileName);
            } else {
                // טיפול בקבצים אחרים (JSON/Assets) במידה ויש
                destination = path.join(tmpDir, fileName);
            }
            
            await fs.ensureDir(path.dirname(destination));
            await fs.writeFile(destination, content);
        }

        // 5. הרצת תהליך הקומפילציה
        log('Starting Gradle execution (RAM limit: 1024MB)...');
        
        const gradleProcess = spawnSync('./gradlew', ['build', '--no-daemon', '-x', 'test'], {
            cwd: tmpDir,
            timeout: 600000, // 10 דקות - מספיק זמן להורדת ספריות בפעם הראשונה
            encoding: 'utf8',
            env: {
                ...process.env,
                // אופטימיזציה ל-Railway: הגבלת ה-Heap כדי למנוע קריסת Container
                GRADLE_OPTS: "-Xmx1024m -Xms512m -Dorg.gradle.jvmargs=-Xmx1024m",
                GRADLE_USER_HOME: GRADLE_CACHE_DIR
            }
        });

        if (gradleProcess.error) {
            throw new Error(`Execution error: ${gradleProcess.error.message}`);
        }

        // איסוף הלוגים של Gradle
        if (gradleProcess.stdout) logs.push(gradleProcess.stdout);
        if (gradleProcess.stderr) logs.push(gradleProcess.stderr);

        if (gradleProcess.status !== 0) {
            log(`Build failed with exit code: ${gradleProcess.status}`);
            return res.status(500).json({
                success: false,
                error: 'Gradle compilation failed',
                logs: logs.slice(-50) // שליחת 50 השורות האחרונות בלבד כדי לא להעמיס
            });
        }

        // 6. איתור קובץ ה-JAR המוכן
        log('Locating build artifacts...');
        const libsDir = path.join(tmpDir, 'build/libs');
        if (!(await fs.pathExists(libsDir))) {
            throw new Error('Build directory libs/ not found');
        }

        const buildArtifacts = await fs.readdir(libsDir);
        // חיפוש ה-JAR הראשי (מתעלמים מ-dev ומ-sources)
        const mainJar = buildArtifacts.find(file => 
            file.endsWith('.jar') && 
            !file.includes('-dev') && 
            !file.includes('-sources')
        );

        if (!mainJar) {
            throw new Error(`Compiled JAR not found. Available files: ${buildArtifacts.join(', ')}`);
        }

        const jarPath = path.join(libsDir, mainJar);
        const jarBuffer = await fs.readFile(jarPath);
        
        log(`Build successful: ${mainJar} (${Math.round(jarBuffer.length / 1024)} KB)`);

        // 7. שליחת התוצאה למשתמש
        res.status(200).json({
            success: true,
            modId: modId,
            file_name: mainJar,
            jar_base64: jarBuffer.toString('base64'),
            logs: ["Build completed successfully"]
        });

    } catch (err) {
        log(`CRITICAL ERROR: ${err.message}`);
        res.status(500).json({
            success: false,
            error: err.message,
            logs: logs.slice(-20)
        });
    } finally {
        // 8. ניקוי תיקייה זמנית למניעת סתימת הדיסק בשרת
        log('Cleaning up temporary workspace...');
        await fs.remove(tmpDir).catch(e => console.error('Cleanup failed:', e));
    }
});

/**
 * אתחול השרת
 */
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ==========================================
    MINECRAFT MOD BUILDER SERVER
    PORT: ${PORT}
    STATUS: READY
    ==========================================
    `);
});
