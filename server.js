const express = require('express');
const { spawnSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const app = express();

app.use(express.json({ limit: '50mb' }));

app.post('/build', async (req, res) => {
    const { files, modId } = req.body;
    const buildId = `build_${Date.now()}`;
    const buildDir = path.join(__dirname, buildId);
    
    try {
        const pkgPath = 'src/main/java/com/buildmeamod';
        await fs.ensureDir(path.join(buildDir, pkgPath));
        
        // יצירת קבצי ה-Java
        for (const [name, content] of Object.entries(files)) {
            if (name.endsWith('.java')) {
                await fs.writeFile(path.join(buildDir, pkgPath, name), content);
            }
        }

        // קבצי הגדרות בסיסיים ל-Fabric
        const buildGradle = `
            plugins { id 'fabric-loom' version '1.4-SNAPSHOT' }
            repositories { mavenCentral(); maven { url 'https://maven.fabricmc.net/' } }
            dependencies { 
                minecraft "com.mojang:minecraft:1.20.1"
                mappings "net.fabricmc:yarn:1.20.1+build.10:v2"
                modImplementation "net.fabricmc:fabric-loader:0.15.6"
            }
        `;
        await fs.writeFile(path.join(buildDir, 'build.gradle'), buildGradle);
        await fs.writeFile(path.join(buildDir, 'settings.gradle'), "rootProject.name = 'mod'");

        // הרצה עם הגבלת זיכרון ל-Railway
        const result = spawnSync('./gradlew', ['build', '-Dorg.gradle.jvmargs=-Xmx400m'], { cwd: buildDir });

        const jarPath = path.join(buildDir, `build/libs/mod-1.0.0.jar`);
        if (fs.existsSync(jarPath)) {
            res.download(jarPath);
        } else {
            res.status(500).send("Build failed. Logs: " + result.stderr.toString());
        }
    } catch (e) {
        res.status(500).send(e.message);
    } finally {
        // ניקוי הקבצים לאחר 10 שניות
        setTimeout(() => fs.remove(buildDir), 10000);
    }
});

app.listen(process.env.PORT || 3000);
