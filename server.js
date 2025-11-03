// server.js
const express = require('express');
const path = require('path');
const { fileURLToPath } = require('url');
const fs = require('fs');
const cors = require('cors');
const bodyParser = require('body-parser');

// THIS IS THE CORRECT SERVER-SIDE IMPORT
const flmngr_express = require('@flmngr/flmngr-server-node-express');

// --- Setup paths ---
const app = express();
const port = 3000;

// --- Middlewares ---
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve index.html, app.js, etc.

// --- Flmngr Backend API Endpoint ---
const filesDir = path.join(__dirname, 'files');

// Use 'bindFlmngr' to automatically create the '/flmngr' API endpoint
flmngr_express.bindFlmngr({
    app: app,
    urlFileManager: "/flmngr", // The API route Flmngr client will call
    dirFiles: filesDir        // The REAL directory on your server
});

console.log(`Flmngr API endpoint registered at /flmngr`);
console.log(`Serving files from: ${filesDir}`);

// --- Custom API for Codemirror (This remains the same) ---
app.get('/api/read', (req, res) => {
    const filePath = req.query.path;
    const safeBase = path.resolve(filesDir);
    const safePath = path.resolve(path.join(filesDir, filePath));

    if (!safePath.startsWith(safeBase)) {
        return res.status(403).send('Forbidden: Access Denied');
    }

    fs.readFile(safePath, 'utf8', (err, data) => {
        if (err) return res.status(500).send('Error reading file');
        res.send(data);
    });
});

app.post('/api/save', (req, res) => {
    const { path: filePath, content } = req.body;
    const safeBase = path.resolve(filesDir);
    const safePath = path.resolve(path.join(filesDir, filePath));

    if (!safePath.startsWith(safeBase)) {
        return res.status(403).send('Forbidden: Access Denied');
    }

    fs.writeFile(safePath, content, 'utf8', (err) => {
        if (err) return res.status(500).send('Error saving file');
        res.send({ message: 'File saved successfully' });
    });
});

// --- Start Server ---
app.listen(port, () => {
    console.log(`Mini OS File Manager listening at http://localhost:${port}`);
});