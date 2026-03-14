const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send("SERVER IS UP"));

app.post('/build', (req, res) => {
    console.log("!!! GOT A BUILD REQUEST !!!"); // זה חייב להופיע בלוגים
    res.json({ success: true, message: "I received your request!" });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Test server listening on ${PORT}`));
