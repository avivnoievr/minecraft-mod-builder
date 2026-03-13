# Minecraft Mod Build Server

שרת Node.js + Java שמקמפל Fabric mods אמיתיים.

## פריסה ב-Railway

### שלב 1 - GitHub
1. צור repo חדש ב-GitHub
2. העלה את הקבצים: `server.js`, `package.json`, `Dockerfile`

### שלב 2 - Railway
1. כנס ל-https://railway.app
2. לחץ "New Project" → "Deploy from GitHub repo"
3. בחר את ה-repo שיצרת
4. Railway יזהה את ה-Dockerfile אוטומטית ויבנה

### שלב 3 - קבלת ה-URL
1. אחרי הדיפלוי, לחץ על הפרויקט ב-Railway
2. עבור ל-"Settings" → "Networking" → "Generate Domain"
3. קבל URL בפורמט: `https://your-app.railway.app`

### שלב 4 - עדכון Base44
1. ב-Base44, עבור ל-Secrets
2. הוסף secret חדש:
   - Name: `BUILD_SERVER_URL`  
   - Value: `https://your-app.railway.app` (ה-URL מ-Railway)
3. שמור את `buildModJar.ts` החדש בפונקציות של Base44

## בדיקה
```bash
curl -X POST https://your-app.railway.app/build \
  -H "Content-Type: application/json" \
  -d '{"modName":"test","generated_files":{"Main":"..."}}'
```

## עלות
- Railway חינמי עד $5/חודש (מספיק למאות builds)
