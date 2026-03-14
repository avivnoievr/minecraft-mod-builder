const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');

const app = express();
app.use(express.json({ limit: '10mb' }));

const LOCKED_PKG = 'buildmeamod';
const MC_VERSION = '1.20.1';
const FABRIC_LOADER = '0.15.6';
const FABRIC_API = '0.92.2+1.20.1';
const YARN = '1.20.1+build.10';

// Gradle cache משותף בין כל הbuildים
const GRADLE_CACHE = path.join(os.tmpdir(), '.gradle-cache');
fs.mkdirSync(GRADLE_CACHE, { recursive: true });

app.get('/', (req, res) => res.json({ status: 'ok' }));

app.post('/build', async (req, res) => {
    const { modName, generated_files, projectId } = req.body;
    const tmpDir = path.join('/tmp', `build-${projectId}-${Date.now()}`);
    const GRADLE_CACHE = '/tmp/.gradle-cache';

    try {
        console.log(`[${new Date().toISOString()}] Starting build for: ${modName}`);
        
        // 1. יצירת מבנה התיקיות
        const pkgPath = 'src/main/java/com/aviv/mod';
        await fs.ensureDir(path.join(tmpDir, pkgPath));
        await fs.ensureDir(GRADLE_CACHE);

        // 2. כתיבת קבצי ה-Java שנוצרו
        for (const [name, content] of Object.entries(generated_files)) {
            await fs.writeFile(path.join(tmpDir, pkgPath, `${name}.java`), content);
        }

        // 3. הרצת Gradle - השילוב המנצח של כל הפונקציות
        console.log('Running Gradle build with RAM limits...');
        const result = spawnSync('./gradlew', [
            'build', 
            '--no-daemon',    // מונע השארת תהליכים פתוחים שזוללים RAM
            '-x', 'test',     // מדלג על בדיקות מיותרות
            '--stacktrace',   // מראה שגיאות מפורטות אם נכשל
            '--info'          // נותן לנו לוגים בזמן אמת
        ], {
            cwd: tmpDir,
            timeout: 600000, // 10 דקות (הגדלנו בגלל ה-Timeout שראינו)
            encoding: 'utf8',
            env: {
                ...process.env,
                // הגבלת זיכרון חכמה: Xmx זה המקסימום, Xms זה ההתחלה
                GRADLE_OPTS: "-Xmx1200m -Xms512m -Dorg.gradle.jvmargs=-Xmx1200m",
                GRADLE_USER_HOME: GRADLE_CACHE, // שימוש בתיקיית ה-Cache שחוסכת זמן
                JAVA_HOME: process.env.JAVA_HOME || '/opt/java/openjdk',
            }
        });

        // 4. בדיקת תוצאה
        if (result.status !== 0) {
            console.error('Gradle build failed!');
            return res.status(500).json({
                success: false,
                error: 'Build failed',
                logs: result.stdout + result.stderr // שולחים הכל כדי שתוכל לראות ב-Dashboard
            });
        }

        // 5. איתור ה-JAR ושליחתו כ-Base64
        const libsDir = path.join(tmpDir, 'build/libs');
        const files = await fs.readdir(libsDir);
        const jarFile = files.find(f => f.endsWith('.jar') && !f.includes('-dev') && !f.includes('-sources'));

        if (!jarFile) throw new Error("JAR file not found in build/libs");

        const jarPath = path.join(libsDir, jarFile);
        const jarBase64 = (await fs.readFile(jarPath)).toString('base64');

        console.log('Build successful, sending JAR back...');
        res.json({
            success: true,
            jar_base64: jarBase64,
            file_name: jarFile,
            logs: result.stdout
        });

    } catch (err) {
        console.error('Server Error:', err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        // ניקוי תיקיית הבנייה כדי לא לסתום את הדיסק (אבל משאירים את ה-Cache!)
        setTimeout(() => fs.remove(tmpDir).catch(console.error), 5000);
    }
5 דקות - הורדת MC לוקחת זמן בפעם הראשונה
      encoding: 'utf8',
      env: {
        ...process.env,
        GRADLE_USER_HOME: GRADLE_CACHE,
        JAVA_HOME: process.env.JAVA_HOME || '/opt/java/openjdk',
      }
    });

    const output = (result.stdout || '') + (result.stderr || '');

    if (result.status !== 0) {
      // מציג רק את שורות השגיאה הרלוונטיות
      const errorLines = output.split('\n')
        .filter(l => l.includes('error:') || l.includes('FAILED') || l.includes('Exception') || l.includes('> Task'))
        .slice(0, 30)
        .join('\n');
      log('Gradle failed: ' + errorLines);
      throw new Error('Build failed:\n' + errorLines);
    }

    // מצא את ה-JAR
    const libsDir = path.join(tmpDir, 'build', 'libs');
    if (!fs.existsSync(libsDir)) throw new Error('build/libs not found');

    const jarFiles = fs.readdirSync(libsDir).filter(f => f.endsWith('.jar') && !f.includes('sources') && !f.includes('dev'));
    if (jarFiles.length === 0) throw new Error('No JAR found. Files: ' + fs.readdirSync(libsDir).join(', '));

    const jarBuffer = fs.readFileSync(path.join(libsDir, jarFiles[0]));
    const sizeKb = Math.round(jarBuffer.length / 1024);
    log(`Success! ${jarFiles[0]} (${sizeKb} KB)`);

    return res.json({
      success: true,
      file_name: modId + '-1.0.0.jar',
      jar_base64: jarBuffer.toString('base64'),
      size_kb: String(sizeKb),
      file_count: javaCount + 10,
      manifest: {
        sourceFiles: javaCount,
        items: (gf._registry_items || '').split(',').filter(Boolean),
        blocks: (gf._registry_blocks || '').split(',').filter(Boolean),
        dataPackFiles: 4,
      },
      logs,
    });

  } catch (err) {
    log('ERROR: ' + err.message);
    return res.status(500).json({ success: false, error: err.message, logs });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Mod builder on port ' + PORT));
