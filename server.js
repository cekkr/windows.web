// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cors = require('cors');
const bodyParser = require('body-parser');
const connectBusboy = require('connect-busboy');
const { FlmngrServer } = require('@flmngr/flmngr-server-node');

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
                    console.warn(`[Flmngr] Skipping subdirectory "${entry.name}" under "${dir}" from ${source}: not accessible (${err.code}).`);
                    continue;
                }
                console.warn(`[Flmngr] Unable to access subdirectory "${entry.name}" under "${dir}" from ${source}: ${err.message}`);
                return { ok: false, reason: 'subdir', error: err };
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

    const getuid = typeof process.getuid === 'function' ? process.getuid : null;
    const isRootUser = getuid ? getuid() === 0 : false;
    const userRootDir = isRootUser ? path.resolve('/') : os.homedir();

    if (!userRootDir) {
        console.warn('[Flmngr] Unable to determine home directory for the current user; falling back to application default.');
    }

    const candidates = [
        { dir: configuredDir, source: 'FLMNGR_ROOT_DIR' },
        { dir: userRootDir, source: isRootUser ? 'root user directory "/"' : 'current user home directory' },
        { dir: DEFAULT_FILES_DIR, source: 'application default' }
    ].filter(candidate => !!candidate.dir);

    for (const candidate of candidates) {
        const result = ensureDirectoryUsable(candidate.dir, { source: candidate.source });
        if (result.ok) {
            return candidate.dir;
        }

        if (
            candidate.source.includes('home') &&
            result.reason === 'access' &&
            process.platform === 'darwin'
        ) {
            console.warn('[Flmngr] macOS may require granting Full Disk Access to this application to use the home directory.');
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

function toStringOrDefault(req, name, defaultValue = null) {
    if (!req.body) return defaultValue;
    const value = req.body[name];
    return typeof value === 'string' ? value : defaultValue;
}

function toArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return [value];
    return [];
}

function toInteger(value, defaultValue) {
    if (typeof value === 'number' && Number.isInteger(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isNaN(parsed)) return parsed;
    }
    return defaultValue;
}

function createRequestWrapper(req) {
    return {
        getParameterNumber(name, defaultValue) {
            const raw = toStringOrDefault(req, name, null);
            if (raw !== null && `${parseInt(raw, 10)}` === raw) {
                return parseInt(raw, 10);
            }
            return defaultValue;
        },
        getParameterString(name, defaultValue) {
            const value = toStringOrDefault(req, name, null);
            return value !== null ? value : defaultValue;
        },
        getParameterStringArray(name, defaultValue) {
            if (!req.body) return defaultValue;
            const value = req.body[name];
            if (typeof value === 'string') return [value];
            if (Array.isArray(value)) return value;
            return defaultValue;
        },
        getParameterFile(name) {
            if (!req.postFile || name !== 'file') return null;
            const rawName = req.postFile.filename;
            let resolvedName = rawName;
            if (rawName && typeof rawName === 'object' && typeof rawName.filename === 'string') {
                resolvedName = rawName.filename;
            }
            return {
                data: req.postFile.data,
                fileName: resolvedName || ''
            };
        }
    };
}

function wildcardToRegExp(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\*/g, '.*')
        .replace(/\\\?/g, '.');
    return new RegExp(`^${escaped}$`);
}

function compileHidePatterns(patterns) {
    return patterns
        .filter(Boolean)
        .map(pattern => ({ pattern, regex: wildcardToRegExp(pattern) }));
}

function isPermissionError(err) {
    return Boolean(err && (err.code === 'EACCES' || err.code === 'EPERM'));
}

function matchesHidePattern(name, hidePatterns) {
    for (const entry of hidePatterns) {
        if (entry.regex.test(name)) {
            return true;
        }
    }
    return false;
}

function listSubdirectories(dirPath, hidePatterns) {
    const subdirs = [];
    let dirHandle;

    try {
        dirHandle = fs.opendirSync(dirPath);
    } catch (err) {
        if (isPermissionError(err) || (err && err.code === 'ENOENT')) {
            return subdirs;
        }
        throw err;
    }

    try {
        let dirent;
        while ((dirent = dirHandle.readSync()) !== null) {
            const name = dirent.name;

            if (matchesHidePattern(name, hidePatterns)) {
                continue;
            }

            const childAbsolute = path.join(dirPath, name);
            let isDir = dirent.isDirectory();

            if (!isDir) {
                try {
                    isDir = fs.statSync(childAbsolute).isDirectory();
                } catch (err) {
                    if (isPermissionError(err) || (err && err.code === 'ENOENT')) {
                        continue;
                    }
                    console.warn(`[Flmngr] Error inspecting "${childAbsolute}": ${err.message}`);
                    continue;
                }
            }

            if (!isDir) {
                continue;
            }

            subdirs.push({ name, absolute: childAbsolute });
        }
    } catch (err) {
        if (!isPermissionError(err) && !(err && err.code === 'ENOENT')) {
            console.warn(`[Flmngr] Unable to enumerate "${dirPath}": ${err.message}`);
        }
    } finally {
        if (dirHandle) {
            dirHandle.closeSync();
        }
    }

    return subdirs;
}

function directoryHasSubdirectories(dirPath, hidePatterns) {
    let dirHandle;

    try {
        dirHandle = fs.opendirSync(dirPath);
    } catch (err) {
        if (isPermissionError(err) || (err && err.code === 'ENOENT')) {
            return false;
        }
        throw err;
    }

    try {
        let dirent;
        while ((dirent = dirHandle.readSync()) !== null) {
            const name = dirent.name;

            if (matchesHidePattern(name, hidePatterns)) {
                continue;
            }

            const childAbsolute = path.join(dirPath, name);
            let isDir = dirent.isDirectory();

            if (!isDir) {
                try {
                    isDir = fs.statSync(childAbsolute).isDirectory();
                } catch (err) {
                    if (isPermissionError(err) || (err && err.code === 'ENOENT')) {
                        continue;
                    }
                    console.warn(`[Flmngr] Error inspecting "${childAbsolute}": ${err.message}`);
                    continue;
                }
            }

            if (!isDir) {
                continue;
            }

            return true;
        }
    } catch (err) {
        if (!isPermissionError(err) && !(err && err.code === 'ENOENT')) {
            console.warn(`[Flmngr] Unable to inspect "${dirPath}" for child directories: ${err.message}`);
        }
    } finally {
        if (dirHandle) {
            dirHandle.closeSync();
        }
    }

    return false;
}

function buildDirectoryListing(baseDir, options = {}) {
    const baseResolved = path.resolve(baseDir);
    const hidePatterns = compileHidePatterns([
        ...toArray(options.hideDirs),
        '.cache'
    ]);

    const maxDepthProvided = typeof options.maxDepth !== 'undefined'
        ? toInteger(options.maxDepth, 1)
        : 1;
    const maxDepth = Math.max(0, maxDepthProvided);
    const depthLimit = Math.min(maxDepth, 20);

    const rootNameCandidate = baseResolved.replace(/\/+$/, '') || baseResolved;
    let rootLabel = path.basename(rootNameCandidate);
    if (!rootLabel || rootLabel === path.sep) {
        rootLabel = 'Files';
    }

    let fromDir = typeof options.fromDir === 'string' ? options.fromDir : '';
    fromDir = fromDir.replace(/\\/g, '/');
    fromDir = '/' + fromDir.replace(/^\/+/, '').replace(/\/+$/, '');
    if (fromDir === '/') {
        fromDir = '';
    }

    if (fromDir.includes('..')) {
        return [];
    }

    const relativeFrom = fromDir.replace(/^\/+/, '');
    const rawSegments = relativeFrom.length > 0 ? relativeFrom.split('/').filter(Boolean) : [];
    let fsSegments = rawSegments;

    if (rawSegments.length > 0 && rawSegments[0] && rawSegments[0].toLowerCase() === rootLabel.toLowerCase()) {
        fsSegments = rawSegments.slice(1);
    }

    if (fsSegments.includes('..')) {
        return [];
    }

    const fsRelativePath = fsSegments.length > 0 ? path.join(...fsSegments) : '';
    const startAbsolute = path.resolve(baseResolved, fsRelativePath);
    if (path.relative(baseResolved, startAbsolute).startsWith('..')) {
        return [];
    }

    let stats;
    try {
        stats = fs.statSync(startAbsolute);
    } catch (err) {
        if (isPermissionError(err)) {
            console.warn(`[Flmngr] Cannot access directory "${startAbsolute}": ${err.code}. Skipping.`);
            return [];
        }
        if (err && err.code === 'ENOENT') {
            return [];
        }
        throw err;
    }

    if (!stats.isDirectory()) {
        return [];
    }

    const results = [];
    const pathsSeen = new Set();
    const visited = new Set();

    function record(displaySegments, depth, hasChildren) {
        const displayPath = `/${displaySegments.join('/')}`;
        if (pathsSeen.has(displayPath)) return;
        results.push({ path: displayPath, hasChildren });
        pathsSeen.add(displayPath);
    }

    function traverse(currentPath, currentSegments, depth) {
        let realPath;
        try {
            realPath = fs.realpathSync(currentPath);
        } catch (err) {
            if (isPermissionError(err) || (err && err.code === 'ENOENT')) {
                realPath = currentPath;
            } else {
                throw err;
            }
        }

        if (visited.has(realPath)) {
            return;
        }
        visited.add(realPath);

        const displaySegments = [rootLabel, ...currentSegments];
        let childDirs = [];
        let hasChildren = false;

        if (depth < depthLimit) {
            childDirs = listSubdirectories(currentPath, hidePatterns);
            hasChildren = childDirs.length > 0;
        } else {
            hasChildren = directoryHasSubdirectories(currentPath, hidePatterns);
        }

        record(displaySegments, depth, hasChildren);

        if (depth >= depthLimit) {
            return;
        }

        for (const child of childDirs.sort((a, b) => a.name.localeCompare(b.name))) {
            traverse(child.absolute, currentSegments.concat(child.name), depth + 1);
        }
    }

    try {
        traverse(startAbsolute, fsSegments, 0);
    } catch (err) {
        if (!isPermissionError(err)) {
            throw err;
        }
    }

    return results.map(entry => ({
        p: entry.path,
        filled: entry.hasChildren,
        f: 0,
        d: 0
    }));
}

function sendFlmngrResponse(res, status, headers, payload) {
    if (headers && typeof headers === 'object') {
        Object.entries(headers).forEach(([header, value]) => {
            if (typeof value !== 'undefined') {
                res.setHeader(header, value);
            }
        });
    }

    res.status(status);

    if (typeof payload === 'string') {
        res.send(payload);
        return;
    }

    if (payload && typeof payload === 'object' && typeof payload.pipe === 'function') {
        payload.pipe(res);
        return;
    }

    res.json(payload);
}

async function handleFlmngrRequest(req, res, filesDir, baseConfig) {
    const action = (toStringOrDefault(req, 'action', '') || '').trim();

    if (action === 'dirList') {
        const hideDirsRaw = req.body ? req.body.hideDirs : [];
        const maxDepthRaw = req.body ? req.body.maxDepth : undefined;
        const normalizedMaxDepth = Array.isArray(maxDepthRaw) ? maxDepthRaw[0] : maxDepthRaw;
        const data = buildDirectoryListing(filesDir, {
            fromDir: toStringOrDefault(req, 'fromDir', ''),
            hideDirs: hideDirsRaw,
            maxDepth: normalizedMaxDepth
        });
        res.status(200).json({ error: null, data });
        return;
    }

    const requestWrapper = createRequestWrapper(req);
    const config = {
        ...baseConfig,
        request: requestWrapper
    };

    try {
        await FlmngrServer.flmngrRequest(config, {
            onFinish: (status, headers, payload) => {
                sendFlmngrResponse(res, status, headers, payload);
            },
            onLogError: (error) => {
                console.error(error);
            }
        }, 'express');
    } catch (err) {
        console.error('[Flmngr] Request processing failed:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal Server Error', data: null });
        }
    }
}

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

const flmngrConfig = {
    dirFiles: filesDir,
    dirCache: path.join(filesDir, '.cache')
};

app.use('/flmngr', connectBusboy());
app.use('/flmngr', bodyParser.urlencoded({ extended: true }));

app.post('/flmngr', (req, res) => {
    if (!req.body) {
        req.body = {};
    }
    req.postFile = null;

    const finalize = () => {
        Promise
            .resolve(handleFlmngrRequest(req, res, filesDir, flmngrConfig))
            .catch(err => {
                console.error('[Flmngr] Handler error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Internal Server Error', data: null });
                }
            });
    };

    const contentType = (req.headers['content-type'] || '').toLowerCase();
    const useBusboy = req.busboy && /^multipart\//i.test(contentType);

    if (!useBusboy) {
        finalize();
        return;
    }

    req.busboy.on('file', (fieldname, file, filename) => {
        if (fieldname !== 'file') {
            file.resume();
            return;
        }

        req.postFile = {
            filename,
            data: null
        };

        file.on('data', (data) => {
            req.postFile.data = req.postFile.data ? Buffer.concat([req.postFile.data, data]) : data;
        });

        file.on('limit', () => {
            console.warn(`[Flmngr] Upload for "${filename}" exceeded busboy limit.`);
        });
    });

    req.busboy.on('field', (fieldname, val) => {
        if (Object.prototype.hasOwnProperty.call(req.body, fieldname)) {
            if (Array.isArray(req.body[fieldname])) {
                req.body[fieldname].push(val);
            } else {
                req.body[fieldname] = [req.body[fieldname], val];
            }
        } else {
            req.body[fieldname] = val;
        }
    });

    req.busboy.on('error', (err) => {
        console.error('[Flmngr] Busboy error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Upload parser error', data: null });
        }
    });

    req.busboy.on('finish', finalize);

    req.pipe(req.busboy);
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
        if (err) {
            console.error(`[Read] ${safePath}: ${err.message}`);
            return res.status(500).send('Error reading file');
        }
        res.send(data);
    });
});

app.get('/api/pdf', (req, res) => {
    const filePath = req.query.path;
    if (typeof filePath !== 'string') {
        return res.status(400).send('Bad Request: Missing path parameter');
    }
    const { safeBase, safePath } = resolveSafePath(filesDir, filePath);

    if (!safePath.startsWith(safeBase)) {
        return res.status(403).send('Forbidden: Access Denied');
    }

    if (path.extname(safePath).toLowerCase() !== '.pdf') {
        return res.status(400).send('Bad Request: Only PDF files are supported');
    }

    const headers = {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline'
    };

    res.sendFile(safePath, { headers }, (err) => {
        if (err) {
            if (!res.headersSent) {
                res.status(err.statusCode || 500).send('Error loading PDF');
            }
        }
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
