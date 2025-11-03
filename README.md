# Mini OS File Manager

Mini OS File Manager is a lightweight desktop–style file browser for the web. It combines the Flmngr file manager widget with a custom CodeMirror-driven editor so you can explore directories, preview files, and edit text-based resources directly in the browser.

The project ships with an Express backend that exposes Flmngr endpoints, serves static assets, and provides simple REST APIs for reading and saving files. When the server runs with root privileges the file manager is anchored to `/`; otherwise it scopes file access to the current user's home directory for safety.

---

## Features
- **Web-based file manager:** Embeds Flmngr to browse folders, upload assets, and manage files.
- **In-browser code editor:** Opens text formats (JS, CSS, HTML, JSON, Markdown, XML, SVG, TXT) with CodeMirror 6.
- **Drag-and-drop windows:** Editor windows are detachable, draggable modals to mimic a desktop UI.
- **Secure path handling:** Requests are sanitized to prevent directory traversal outside the selected root.
- **Privilege-aware root selection:** Automatically switches between the filesystem root (`/`) and the current user's home directory based on process permissions.
- **REST read/write endpoints:** JSON APIs (`/api/read`, `/api/save`) power the editor while reusing Flmngr for uploads and browsing.

---

## Technology Stack
- **Frontend:** Vanilla JS, ES modules, CodeMirror 6, Flmngr (via jsDelivr CDN).
- **Styling:** Plain CSS (`public/style.css`) with custom window chrome.
- **Backend:** Node.js, Express, `@flmngr/flmngr-server-node-express`, `body-parser`, `cors`.
- **Runtime:** Node 16+ recommended.

---

## Directory Structure
```
.
├── public/
│   ├── index.html        # Loads Flmngr, bootstraps the app.
│   ├── style.css         # Desktop-style layout and window styling.
│   └── app.js            # App logic, CodeMirror integration, Flmngr mounting.
├── files/                # Fallback storage if the computed root does not exist.
├── server.js             # Express server and Flmngr binding.
├── package.json          # Dependencies and scripts.
└── README.md
```

Flmngr and CodeMirror resources are loaded directly from CDN to keep the repo minimal.

---

## Prerequisites
- Node.js v16 or higher
- npm (bundled with Node)
- File system permissions to read/write within the target directory tree

---

## Installation
```bash
npm install
```

This pulls the Express backend, Flmngr server module, and any auxiliary libraries.

---

## Running the App
```bash
npm start
```

The default script launches `server.js` on port `3000`. Visit `http://localhost:3000` to open the Mini OS File Manager UI.

### Root Selection Logic
The backend determines which directory to expose:

1. If the process has `process.getuid` and runs as UID `0` (root), Flmngr is bound to `/`.
2. Otherwise, it uses the current user's home directory (`os.homedir()`).
3. If the computed directory is missing (unexpected), it falls back to `./files` under the project root.

This logic lives near the top of `server.js` and ensures Flmngr only lists files you're allowed to touch.

---

## API Reference

### `GET /api/read?path=<relative-path>`
Reads a text file under the managed root.
- **Query:** `path` – required relative path (e.g., `/notes/todo.txt`).
- **Responses:**
  - `200 OK` with raw file contents.
  - `400 Bad Request` if `path` is missing.
  - `403 Forbidden` if the resolved path falls outside the base directory.
  - `500 Internal Server Error` if reading fails.

### `POST /api/save`
Writes text into a file (creates or overwrites).
- **Body:** JSON `{ path: "/notes/todo.txt", content: "..." }`
- **Responses:**
  - `200 OK` on success.
  - `400 Bad Request` if `path` is missing.
  - `403 Forbidden` if the path is outside the allowed root.
  - `500 Internal Server Error` if the write fails.

Path resolution is centralized in `resolveSafePath` to sanitize user input and block directory traversal sequences (e.g., `../`).

---

## Frontend Behavior
- `public/index.html` loads Flmngr from jsDelivr (`flmngr@2.0.19`) and the module script `app.js`.
- On `DOMContentLoaded`, `app.js` mounts Flmngr into the `#filemanager` div via `Flmngr.mount(...)`.
- The `onItemClick` hook opens supported text files in a draggable CodeMirror editor window and returns `false` to stop Flmngr's download workflow.
- Closing a window destroys the associated CodeMirror instance; saving sends the current document to `/api/save`.

If Flmngr fails to load (e.g., CDN outage) the console logs an error and the app exits gracefully.

---

## Customization Tips
- **Change allowed file types:** Modify `textualExtensions` in `public/app.js`.
- **Default server port:** Adjust `const port = 3000;` in `server.js` or set `PORT` via environment variable and read it there.
- **Alternative base directory:** Override the computed `filesDir` before binding Flmngr if you need a fixed path.
- **Styling tweaks:** Edit `public/style.css` to adjust window chrome, colors, or layout.

---

## Troubleshooting
- **Flmngr fails to mount:** Ensure the CDN script (`https://cdn.jsdelivr.net/.../flmngr@2.0.19/dist/index.js`) loads—check your network or consider pinning a local copy.
- **403 Forbidden on read/save:** The path resolves outside the selected root; inspect `filePath` or run the server with the necessary privileges.
- **Uploads/editing fail silently:** Check server logs for exceptions from `fs.readFile`/`fs.writeFile` or Flmngr backend output.
- **Styling anomalies:** Confirm `public/style.css` is delivered; browser cache wipes often help during development.

---

## License
This project builds on Flmngr, which is distributed under LGPL 3.0+. Review Flmngr's licensing terms for production use. No additional license has been specified for the surrounding demo code—adapt as needed.

---

## Acknowledgements
- [Flmngr](https://flmngr.com) for the file manager and image tooling.
- [CodeMirror](https://codemirror.net) for the in-browser code editor.
- Express community for the HTTP framework.

