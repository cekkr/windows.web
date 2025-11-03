// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const bodyParser = require('body-parser');

const DEFAULT_FILES_DIR = path.join(__dirname, 'files');

function ensureDirectoryUsable(dir, opts = {}) {
    const source = opts.source || 'unknown';
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
        console.warn(`[Flmngr] Unable to create directory "${dir}" from ${source}: ${err.message}`);
        return { ok: false, reason: 'mkdir', error: err };
    }

    try {
        fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
    } catch (err) {
        console.warn(`[Flmngr] Directory "${dir}" from ${source} is not readable/writable: ${err.message}`);
        return { ok: false, reason: 'access', error: err };
    }

    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const subdir = path.join(dir, entry.name);
            try {
                fs.accessSync(subdir, fs.constants.R_OK);
            } catch (err) {
                if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
                    console.warn(`[Flmngr] Skipping directory "${dir}" from ${source}: subdirectory "${entry.name}" is not accessible (${err.code}).`);
                    return { ok: false, reason: 'subdir', error: err };
                }
            }
        }
    } catch (err) {
        if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
            console.warn(`[Flmngr] Unable to inspect contents of "${dir}" from ${source}: ${err.message}`);
            return { ok: false, reason: 'inspect', error: err };
        }
    }

    return { ok: true };
}

function resolveFilesDirectory() {
    const configuredDir = process.env.FLMNGR_ROOT_DIR
        ? path.resolve(process.env.FLMNGR_ROOT_DIR)
        : null;

    const candidates = [
        { dir: configuredDir, source: 'FLMNGR_ROOT_DIR' },
        { dir: DEFAULT_FILES_DIR, source: 'application default' }
    ].filter(candidate => !!candidate.dir);

    for (const candidate of candidates) {
        const result = ensureDirectoryUsable(candidate.dir, { source: candidate.source });
        if (result.ok) {
            return candidate.dir;
        }
    }

    throw new Error('Unable to find an accessible directory for Flmngr storage. Set FLMNGR_ROOT_DIR to a readable and writable path.');
}

function resolveSafePath(baseDir, requestedPath) {
    const safeBase = path.resolve(baseDir);
    const sanitized = path.normalize(requestedPath).replace(/^([/\\])+/, '');
    const safePath = path.resolve(safeBase, sanitized);
    return { safeBase, safePath };
}

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
let filesDir;
try {
    filesDir = resolveFilesDirectory();
} catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    throw err;
}

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
    if (typeof filePath !== 'string') {
        return res.status(400).send('Bad Request: Missing path parameter');
    }
    const { safeBase, safePath } = resolveSafePath(filesDir, filePath);

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
    if (typeof filePath !== 'string') {
        return res.status(400).send('Bad Request: Missing path parameter');
    }
    const { safeBase, safePath } = resolveSafePath(filesDir, filePath);

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

// Handle server startup errors (like "port in use")
app.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`ERROR: Port ${port} is already in use.`);
  } else {
    console.error('Server startup error:', err);
  }
  process.exit(1); // Exit with an error code
});

