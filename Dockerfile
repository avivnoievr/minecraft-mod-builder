# משתמשים בגרסה עדכנית של Node
FROM node:18

# מתקינים את Java (כי אנחנו צריכים Gradle לבניית המוד)
RUN apt-get update && apt-get install -y openjdk-17-jdk

# הגדרת תיקיית עבודה
WORKDIR /app

# העתקת קבצי החבילות והתקנה
COPY package*.json ./
RUN npm install

# העתקת כל שאר הקבצים
COPY . .

# הגדרת משתנה סביבה לפורט של Railway
ENV PORT=3000
EXPOSE 3000

# פקודת ההרצה
CMD ["node", "server.js"]
