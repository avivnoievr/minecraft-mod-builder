const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');

const app = express();
app.use(express.json({ limit: '50mb' }));

const GRADLE_CACHE = path.join(os.tmpdir(), '.gradle-cache');

app.get('/', (req, res) => res.json({ status: 'Mod Builder Online' }));

app.post('/build', async (req, res) => {
  const { projectId, modName, generated_files } = req.body;
  const modId = (modName || 'mymod').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const tmpDir = path.join(os.tmpdir(), `build-${projectId}-${Date.now()}`);
  const logs = [];
  const log = (msg) => { logs.push(msg); console.log(`[BUILD] ${msg}`); };

  try {
    log(`Preparing workspace for: ${modId}`);
    await fs.ensureDir(tmpDir);

    // 1. העתקת תשתית Gradle מהשורש לתיקייה הזמנית
    log('Copying build infrastructure...');
    const baseFiles = ['gradlew', 'gradle', 'build.gradle', 'settings.gradle', 'gradle.properties'];
    for (const f of baseFiles) {
      const src = path.join(__dirname, f);
      if (await fs.pathExists(src)) await fs.copy(src, path.join(tmpDir, f));
    }
    if (process.platform !== 'win32') {
      await fs.chmod(path.join(tmpDir, 'gradlew'), '755');
    }

    // 2. יצירת מבנה התיקיות המלא (הלוגיקה של קלוד)
    const srcDir = path.join(tmpDir, 'src/main/java/com/buildmeamod');
    await fs.ensureDir(path.join(srcDir, 'registry'));
    await fs.ensureDir(path.join(srcDir, 'item'));
    await fs.ensureDir(path.join(tmpDir, 'src/main/resources/assets', modId, 'textures/item'));
    await fs.ensureDir(path.join(tmpDir, 'src/main/resources/assets', modId, 'models/item'));

    // 3. כתיבת קבצי ה-Java
    log('Writing source files...');
    for (const [name, content] of Object.entries(generated_files)) {
      let filePath;
      if (name === 'Main') {
        filePath = path.join(srcDir, 'Main.java');
      } else if (name.includes('Items') || name.includes('Blocks')) {
        filePath = path.join(srcDir, 'registry', `${name}.java`);
      } else {
        filePath = path.join(srcDir, 'item', `${name}.java`);
      }
      await fs.writeFile(filePath, content);
    }

    // 4. הרצת Gradle
    log('Executing Gradle build (RAM: 1GB)...');
    const result = spawnSync('./gradlew', ['build', '--no-daemon'], {
      cwd: tmpDir,
      timeout: 600000,
      encoding: 'utf8',
      env: {
        ...process.env,
        GRADLE_OPTS: "-Xmx1024m -Xms512m",
        GRADLE_USER_HOME: GRADLE_CACHE
      }
    });

    if (result.status !== 0) {
      log('Gradle failed!');
      throw new Error(result.stderr || 'Unknown Gradle error');
    }

    // 5. איתור ה-JAR ושליחתו
    const libsDir = path.join(tmpDir, 'build/libs');
    const files = await fs.readdir(libsDir);
    const jarFile = files.find(f => f.endsWith('.jar') && !f.includes('-dev'));
    
    if (!jarFile) throw new Error('JAR not found in build/libs');

    const jarBuffer = await fs.readFile(path.join(libsDir, jarFile));
    log('Build successful!');

    res.json({
      success: true,
      jar_base64: jarBuffer.toString('base64'),
      file_name: jarFile,
      logs
    });

  } catch (err) {
    log(`ERROR: ${err.message}`);
    res.status(500).json({ success: false, error: err.message, logs });
  } finally {
    await fs.remove(tmpDir).catch(() => {});
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
