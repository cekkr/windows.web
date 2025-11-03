// public/app.js

// --- Codemirror Setup (ESM from CDN) ---
// We import exactly what we need, directly from the CDN
import { EditorState } from "https://unpkg.com/@codemirror/state@6.2.0/dist/index.js";
import { EditorView, keymap } from "https://unpkg.com/@codemirror/view@6.9.1/dist/index.js";
import { defaultKeymap } from "https://unpkg.com/@codemirror/commands@6.2.2/dist/index.js";
import { javascript } from "https://unpkg.com/@codemirror/lang-javascript@6.1.4/dist/index.js";
import { css } from "https://unpkg.com/@codemirror/lang-css@6.0.2/dist/index.js";
import { html } from "https://unpkg.com/@codemirror/lang-html@6.4.3/dist/index.js";
import { json } from "https://unpkg.com/@codemirror/lang-json@6.0.1/dist/index.js";

// A map to get the correct language highlighter
const langExtensions = {
    js: javascript,
    css: css,
    html: html,
    json: json,
    txt: () => [] // No specific language for .txt
};

let editorInstance = null; // To hold the active Codemirror instance

/**
 * Creates and opens the editor window
 * @param {string} filePath - The path of the file to edit (e.g., "/script.js")
 */
async function openEditorWindow(filePath) {
    try {
        // 1. Fetch file content from our Node.js server
        const response = await fetch(`/api/read?path=${encodeURIComponent(filePath)}`);
        if (!response.ok) {
            throw new Error(`Failed to load file: ${response.statusText}`);
        }
        const fileContent = await response.text();

        // 2. Clone the window template
        const template = document.getElementById('editor-window-template');
        const newWindow = template.cloneNode(true);
        newWindow.style.display = 'flex';
        newWindow.id = `window-${Date.now()}`;

        // 3. Set window properties
        const titleEl = newWindow.querySelector('.editor-title');
        const contentEl = newWindow.querySelector('.editor-content');
        const saveBtn = newWindow.querySelector('.editor-save');
        const closeBtn = newWindow.querySelector('.editor-close');

        titleEl.textContent = filePath;

        // 4. Initialize Codemirror
        const fileExt = filePath.split('.').pop();
        const langExt = (langExtensions[fileExt] || (() => []))();

        let startState = EditorState.create({
            doc: fileContent,
            extensions: [
                keymap.of(defaultKeymap),
                langExt
            ]
        });

        editorInstance = new EditorView({
            state: startState,
            parent: contentEl
        });

        // 5. Add event listeners for Save and Close
        closeBtn.addEventListener('click', () => {
            editorInstance.destroy();
            newWindow.remove();
            editorInstance = null;
        });

        saveBtn.addEventListener('click', async () => {
            const currentContent = editorInstance.state.doc.toString();
            saveBtn.textContent = 'Saving...';
            try {
                const saveResponse = await fetch('/api/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        path: filePath,
                        content: currentContent
                    }),
                });
                if (!saveResponse.ok) throw new Error('Save failed');
                
                saveBtn.textContent = 'Saved!';
                setTimeout(() => (saveBtn.textContent = 'Save'), 2000);

            } catch (err) {
                console.error(err);
                alert('Error saving file: ' + err.message);
                saveBtn.textContent = 'Save';
            }
        });

        // 6. Add the new window to the page
        document.body.appendChild(newWindow);

        // 7. Make the window draggable
        makeDraggable(newWindow, newWindow.querySelector('.editor-header'));

    } catch (err) {
        console.error(err);
        alert('Error opening file: ' + err.message);
    }
}

/**
 * Makes an element draggable by its header
 */
function makeDraggable(el, header) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    header.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        el.style.top = (el.offsetTop - pos2) + "px";
        el.style.left = (el.offsetLeft - pos1) + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

// --- App Initialization ---
// We wrap this in a DOMContentLoaded listener to ensure
// the #filemanager div and Flmngr script exist.
document.addEventListener("DOMContentLoaded", () => {
    
    // List of file extensions we want to open in Codemirror
    const textualExtensions = ['txt', 'js', 'json', 'css', 'html', 'md', 'xml', 'svg'];

    // Flmngr (from the CDN script) attaches itself to the 'window' object
    window.Flmngr.open({
        apiKey: "FLMNFLMN", // Public key for localhost testing
        urlFileManager: "/flmngr", // Our Node.js backend endpoint
        element: "#filemanager",

        // The callback to intercept file clicks
        onItemClick(item) {
            const ext = item.name.split('.').pop().toLowerCase();

            if (item.isFile && textualExtensions.includes(ext)) {
                openEditorWindow(item.path); 
                return false; // Prevent default download behavior
            }
            return true; // Allow default folder navigation
        }
    });
});