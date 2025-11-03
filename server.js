// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import cors from 'cors';
import bodyParser from 'body-parser';

// THIS IS THE CORRECT IMPORT YOU SAID
import { Flmngr } from 'flmngr';

// --- Setup paths ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = 3000;

// --- Middlewares ---
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Serve Flmngr Client Files ---
// This finds the 'flmngr' package in node_modules and serves its files
try {
    // Get the directory of the 'flmngr' package
    const flmngrDir = path.dirname(fileURLToPath(import.meta.resolve('flmngr')));
    // Serve its client-side files from a route, e.g., /flmngr-client
    app.use('/flmngr-client', express.static(flmngrDir));
    console.log(`Serving Flmngr client files from: ${flmngrDir}`);
} catch (e) {
    console.error("Could not find 'flmngr' package. Did you run 'npm install flmngr'?", e);
}

// --- Flmngr Backend API Endpoint ---
const filesDir = path.join(__dirname, 'files');
app.all('/flmngr', (req, res) => {
    Flmngr.local({
        dir: filesDir
    }, req, res);
});

// --- Custom API for Codemirror Editor ---
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
    console.log(`Serving local files from: ${filesDir}`);
});