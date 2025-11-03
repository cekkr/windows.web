// public/app.js

// --- Codemirror Setup (ESM from CDN) ---
// We import exactly what we need, directly from the CDN
import { EditorState } from "https://unpkg.com/@codemirror/state@6.2.0/dist/index.js?module";
import { EditorView, keymap } from "https://unpkg.com/@codemirror/view@6.9.1/dist/index.js?module";
import { defaultKeymap } from "https://unpkg.com/@codemirror/commands@6.2.2/dist/index.js?module";
import { javascript } from "https://unpkg.com/@codemirror/lang-javascript@6.1.4/dist/index.js?module";
import { css } from "https://unpkg.com/@codemirror/lang-css@6.0.2/dist/index.js?module";
import { html } from "https://unpkg.com/@codemirror/lang-html@6.4.3/dist/index.js?module";
import { json } from "https://unpkg.com/@codemirror/lang-json@6.0.1/dist/index.js?module";

// A map to get the correct language highlighter
const langExtensions = {
    js: javascript,
    css: css,
    html: html,
    json: json,
    txt: () => [] // No specific language for .txt
};

const textualExtensions = ['txt', 'js', 'json', 'css', 'html', 'md', 'xml', 'svg'];
const pdfExtensions = ['pdf'];
const itemCache = new Map();
const pathAttributeCandidates = [
    'data-entry-path',
    'data-path',
    'data-item-path',
    'data-file-path',
    'data-by-n1ed-path',
    'data-url',
    'data-value'
];

function getFileExtension(fileName) {
    if (typeof fileName !== 'string') return '';
    const parts = fileName.split('.');
    if (parts.length <= 1) return '';
    return parts.pop().toLowerCase();
}

function normalizeItemPath(value) {
    if (typeof value !== 'string') return null;
    let normalized = value.replace(/\\/g, '/');
    if (!normalized.startsWith('/')) {
        normalized = `/${normalized.replace(/^\/+/, '')}`;
    }
    return normalized;
}

function cacheItem(item) {
    if (!item || typeof item.path !== 'string') return;
    const normalized = normalizeItemPath(item.path);
    if (normalized) {
        itemCache.set(normalized, item);
    }
    itemCache.set(item.path, item);
}

function canOpenInEditor(item) {
    if (!item || !item.isFile) return false;
    return textualExtensions.includes(getFileExtension(item.name));
}

function canPreviewPdf(item) {
    if (!item || !item.isFile) return false;
    return pdfExtensions.includes(getFileExtension(item.name));
}

function extractItemFromEvent(target) {
    let node = target && target.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
    while (node && node !== document.body) {
        for (const attr of pathAttributeCandidates) {
            if (node.hasAttribute && node.hasAttribute(attr)) {
                const rawPath = node.getAttribute(attr);
                const normalized = normalizeItemPath(rawPath);
                if (normalized) {
                    return itemCache.get(normalized) || {
                        path: normalized,
                        name: normalized.split('/').pop() || '',
                        isFile: true
                    };
                }
            }
        }
        node = node.parentElement;
    }
    return null;
}

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
        const fileExt = getFileExtension(filePath);
        const langFactory = langExtensions[fileExt] || (() => []);
        const langExt = langFactory();

        const startState = EditorState.create({
            doc: fileContent,
            extensions: [
                keymap.of(defaultKeymap),
                langExt
            ]
        });

        const editorView = new EditorView({
            state: startState,
            parent: contentEl
        });

        // 5. Add event listeners for Save and Close
        closeBtn.addEventListener('click', () => {
            editorView.destroy();
            newWindow.remove();
        });

        saveBtn.addEventListener('click', async () => {
            const currentContent = editorView.state.doc.toString();
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
 * Creates and opens a PDF preview window
 * @param {string} filePath - The path of the PDF file to preview
 */
function openPdfWindow(filePath) {
    try {
        const template = document.getElementById('pdf-window-template');
        if (!template) {
            throw new Error('PDF window template missing in DOM');
        }

        const newWindow = template.cloneNode(true);
        newWindow.style.display = 'flex';
        newWindow.id = `pdf-window-${Date.now()}`;

        const headerEl = newWindow.querySelector('.editor-header');
        const titleEl = newWindow.querySelector('.editor-title');
        const closeBtn = newWindow.querySelector('.editor-close');
        const frameEl = newWindow.querySelector('.pdf-frame');

        if (!frameEl) {
            throw new Error('PDF frame element missing');
        }

        titleEl.textContent = filePath;
        frameEl.src = `/api/pdf?path=${encodeURIComponent(filePath)}`;

        closeBtn.addEventListener('click', () => {
            frameEl.src = '';
            newWindow.remove();
        });

        document.body.appendChild(newWindow);
        makeDraggable(newWindow, headerEl);
    } catch (err) {
        console.error(err);
        alert('Unable to open PDF: ' + err.message);
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
    const editorButton = document.getElementById('open-editor-btn');
    const pdfButton = document.getElementById('preview-pdf-btn');
    const contextMenu = document.getElementById('file-context-menu');
    const contextEditorButton = contextMenu ? contextMenu.querySelector('[data-action="open-editor"]') : null;
    const contextPdfButton = contextMenu ? contextMenu.querySelector('[data-action="preview-pdf"]') : null;
    let selectedItem = null;

    const flmngr = window.Flmngr;
    if (!flmngr || typeof flmngr.mount !== 'function') {
        console.error('Flmngr library failed to load; check the CDN script reference.');
        return;
    }

    const fileManagerHost = document.querySelector('#filemanager');
    if (!fileManagerHost) {
        console.error('Missing #filemanager element to mount Flmngr UI.');
        return;
    }

    function hideContextMenu() {
        if (!contextMenu) return;
        contextMenu.classList.remove('visible');
        contextMenu.style.display = 'none';
    }

    function showContextMenu(x, y) {
        if (!contextMenu) return;
        // Ensure menu fits viewport
        contextMenu.style.display = 'flex';
        contextMenu.classList.add('visible');
        const menuRect = contextMenu.getBoundingClientRect();
        const maxX = window.innerWidth - menuRect.width - 8;
        const maxY = window.innerHeight - menuRect.height - 8;
        const left = Math.min(x, Math.max(0, maxX));
        const top = Math.min(y, Math.max(0, maxY));
        contextMenu.style.left = `${left}px`;
        contextMenu.style.top = `${top}px`;
    }

    function updateContextMenuButtons() {
        if (!contextMenu) return;
        if (contextEditorButton) {
            contextEditorButton.disabled = !canOpenInEditor(selectedItem);
        }
        if (contextPdfButton) {
            contextPdfButton.disabled = !canPreviewPdf(selectedItem);
        }
    }

    function updateToolbarButtons() {
        if (!editorButton || !pdfButton) {
            return;
        }
        if (!selectedItem || !selectedItem.isFile) {
            editorButton.disabled = true;
            pdfButton.disabled = true;
            updateContextMenuButtons();
            return;
        }

        editorButton.disabled = !canOpenInEditor(selectedItem);
        pdfButton.disabled = !canPreviewPdf(selectedItem);
        updateContextMenuButtons();
    }

    function setSelectedItem(item) {
        selectedItem = item;
        updateToolbarButtons();
    }

    if (editorButton) {
        editorButton.addEventListener('click', () => {
            if (selectedItem && selectedItem.isFile) {
                openEditorWindow(selectedItem.path);
            }
        });
    }

    if (pdfButton) {
        pdfButton.addEventListener('click', () => {
            if (selectedItem && selectedItem.isFile) {
                openPdfWindow(selectedItem.path);
            }
        });
    }

    updateToolbarButtons();

    if (contextMenu) {
        contextMenu.addEventListener('click', (event) => {
            event.stopPropagation();
            const action = event.target?.dataset?.action;
            if (!action || !selectedItem || !selectedItem.isFile) {
                hideContextMenu();
                return;
            }
            if (action === 'open-editor' && canOpenInEditor(selectedItem)) {
                openEditorWindow(selectedItem.path);
            } else if (action === 'preview-pdf' && canPreviewPdf(selectedItem)) {
                openPdfWindow(selectedItem.path);
            }
            hideContextMenu();
        });
        contextMenu.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        });
    }

    document.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (contextMenu && contextMenu.contains(event.target)) {
            return;
        }
        hideContextMenu();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            hideContextMenu();
        }
    });

    document.addEventListener('scroll', () => {
        hideContextMenu();
    }, true);

    window.addEventListener('resize', () => {
        hideContextMenu();
    });

    if (fileManagerHost) {
        fileManagerHost.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            const item = extractItemFromEvent(event.target);
            if (item) {
                cacheItem(item);
                setSelectedItem(item);
            }

            if (!selectedItem || !selectedItem.isFile) {
                hideContextMenu();
                return;
            }

            if (!canOpenInEditor(selectedItem) && !canPreviewPdf(selectedItem)) {
                hideContextMenu();
                return;
            }

            showContextMenu(event.clientX, event.clientY);
        });
    }

    flmngr.mount(fileManagerHost, {
        apiKey: "FLMNFLMN",
        urlFileManager: "/flmngr",
        onItemClick(item) {
            cacheItem(item);
            setSelectedItem(item);

            if (!item.isFile) {
                return true;
            }

            const ext = getFileExtension(item.name);

            if (textualExtensions.includes(ext)) {
                openEditorWindow(item.path);
                return false;
            }

            if (pdfExtensions.includes(ext)) {
                openPdfWindow(item.path);
                return false;
            }

            return true;
        }
    });
});
