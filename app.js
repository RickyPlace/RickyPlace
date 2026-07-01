(function() {
    "use strict";

    // ---------- CONFIG DE FIREBASE ----------
    const firebaseConfig = {
        apiKey: "AIzaSyC6QRlDHZ5M710ZPPk6bmgePNuHHEKVy1g",
        authDomain: "splace-f8a61.firebaseapp.com",
        databaseURL: "https://splace-f8a61-default-rtdb.europe-west1.firebasedatabase.app",
        projectId: "splace-f8a61",
        storageBucket: "splace-f8a61.firebasestorage.app",
        messagingSenderId: "509262817197",
        appId: "1:509262817197:web:3961716f1e20d20988a324",
        measurementId: "G-WG7FSYKHR0"
    };

    firebase.initializeApp(firebaseConfig);
    const db = firebase.database();
    const auth = firebase.auth();

    auth.signInAnonymously().catch(function(error) {
        console.error("Error al autenticar anónimamente:", error);
        document.getElementById("syncText").textContent = "Error de autenticación";
    });

    auth.onAuthStateChanged(function(user) {
        if (user) {
            document.getElementById("syncText").textContent = "Conectado · visible para todos";
            cooldownUntil = 0;
            updateCooldownDisplay();
        } else {
            document.getElementById("syncText").textContent = "No autenticado";
        }
    });

    const W = 1000, H = 1000;
    const CHUNK_SIZE = 100;
    const CHUNKS_X = Math.ceil(W / CHUNK_SIZE);
    const CHUNKS_Y = Math.ceil(H / CHUNK_SIZE);
    const CELL = 4;
    const COOLDOWN_MS = 4000;

    const chunksRef = db.ref('lienzo/chunks');
    const countRef = db.ref('lienzo/count');
    const activityRef = db.ref('lienzo/activity');
    const cooldownsRef = db.ref('lienzo/cooldowns');
    const notifRef = db.ref('lienzo/notifications');

    const LAST_NOTIF_KEY = 'splace_last_notification_key';

    // Paleta original de 24 colores
    const basePalette = [
        { hex: "#FFFFFF", name: "Blanco" }, { hex: "#E4E4E4", name: "Gris claro" },
        { hex: "#888888", name: "Gris" }, { hex: "#222222", name: "Negro" },
        { hex: "#FFA7D1", name: "Rosa" }, { hex: "#E50000", name: "Rojo" },
        { hex: "#E59500", name: "Naranja" }, { hex: "#A06A42", name: "Marrón" },
        { hex: "#E5D900", name: "Amarillo" }, { hex: "#94E044", name: "Lima" },
        { hex: "#02BE01", name: "Verde" }, { hex: "#00D3DD", name: "Turquesa" },
        { hex: "#0083C7", name: "Azul cielo" }, { hex: "#0000EA", name: "Azul" },
        { hex: "#CF6EE4", name: "Lila" }, { hex: "#820080", name: "Morado" },
        { hex: "#3690EA", name: "Azul medio" }, { hex: "#00CCC0", name: "Cian" },
        { hex: "#493AC1", name: "Índigo" }, { hex: "#6A5CFF", name: "Violeta" },
        { hex: "#FF3881", name: "Magenta" }, { hex: "#FF4500", name: "Bermellón" },
        { hex: "#FFFFC0", name: "Crema" }, { hex: "#9C6926", name: "Tierra" }
    ];

    let palette = [...basePalette];
    const colorIndexMap = new Map();
    palette.forEach((c, i) => colorIndexMap.set(c.hex, i));

    const CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const idxToChar = i => CHARS[i];
    const charToIdx = c => CHARS.indexOf(c);

    function hexToRgba(hex, a) {
        const v = hex.replace("#","");
        const r = parseInt(v.substring(0,2),16), g = parseInt(v.substring(2,4),16), b = parseInt(v.substring(4,6),16);
        return `rgba(${r},${g},${b},${a})`;
    }

    function escapeHtml(unsafe) {
        return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    const boardChunks = {};

    const canvas = document.getElementById("board");
    const ctx = canvas.getContext("2d");
    const overlay = document.getElementById("hoverOverlay");
    const overlayCtx = overlay.getContext("2d");
    const viewport = document.getElementById("viewport");
    const toastContainer = document.getElementById("toast-container");
    const cooldownTimeEl = document.getElementById("cooldownTime");
    const paletteEl = document.getElementById("palette");
    const selectedColorNameEl = document.getElementById("selectedColorName");
    const placementCountEl = document.getElementById("placementCount");
    const lastActivityMetaEl = document.getElementById("lastActivityMeta");
    const syncText = document.getElementById("syncText");
    const liveDot = document.getElementById("liveDot");
    const gridSizeLabel = document.getElementById("gridSizeLabel");
    const customColorInput = document.getElementById("customColorInput");
    const addCustomColorBtn = document.getElementById("addCustomColor");
    gridSizeLabel.textContent = "1000×1000";

    canvas.width = W;
    canvas.height = H;
    overlay.width = W;
    overlay.height = H;
    canvas.style.width = (W * CELL) + "px";
    canvas.style.height = (H * CELL) + "px";
    overlay.style.width = (W * CELL) + "px";
    overlay.style.height = (H * CELL) + "px";

    let selectedColor = 6;

    function addColorToPalette(hex) {
        if (colorIndexMap.has(hex)) return colorIndexMap.get(hex);
        if (palette.length >= CHARS.length) {
            return findClosestColorIndex(hex);
        }
        const newColor = { hex: hex, name: hex };
        const index = palette.length;
        palette.push(newColor);
        colorIndexMap.set(hex, index);
        paletteEl.appendChild(createSwatch(newColor, index));
        return index;
    }

    function findClosestColorIndex(hex) {
        const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        let minDist = Infinity, idx = 0;
        for (let i = 0; i < palette.length; i++) {
            const h = palette[i].hex;
            const pr = parseInt(h.slice(1,3),16), pg = parseInt(h.slice(3,5),16), pb = parseInt(h.slice(5,7),16);
            const dist = Math.sqrt((r-pr)**2 + (g-pg)**2 + (b-pb)**2);
            if (dist < minDist) { minDist = dist; idx = i; }
        }
        return idx;
    }

    function createSwatch(color, index) {
        const sw = document.createElement("div");
        sw.className = "swatch" + (index === selectedColor ? " selected" : "");
        sw.style.background = color.hex;
        sw.title = color.name || color.hex;
        sw.addEventListener("click", () => {
            selectedColor = index;
            document.querySelectorAll(".swatch").forEach(s => s.classList.remove("selected"));
            sw.classList.add("selected");
            selectedColorNameEl.textContent = color.name || color.hex;
            drawHoverOverlay();
        });
        return sw;
    }

    function buildPalette() {
        paletteEl.innerHTML = "";
        palette.forEach((color, index) => {
            paletteEl.appendChild(createSwatch(color, index));
        });
    }
    buildPalette();
    selectedColorNameEl.textContent = palette[selectedColor].name;

    addCustomColorBtn.addEventListener("click", () => {
        const hex = customColorInput.value.trim().toUpperCase();
        if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
            alert("Formato de color inválido. Usa #rrggbb (ej. #ff5733)");
            return;
        }
        if (colorIndexMap.has(hex)) {
            alert("Ese color ya está en la paleta.");
            return;
        }
        if (palette.length >= CHARS.length) {
            alert("Has alcanzado el máximo de colores permitidos.");
            return;
        }
        const index = addColorToPalette(hex);
        customColorInput.value = "";
        selectedColor = index;
        document.querySelectorAll(".swatch").forEach(s => s.classList.remove("selected"));
        paletteEl.children[index].classList.add("selected");
        selectedColorNameEl.textContent = palette[index].name;
        drawHoverOverlay();
    });

    // ---------- CHUNKS ----------
    function chunkKey(cx, cy) { return cy + "_" + cx; }
    function getChunkCoords(x, y) { return { cx: Math.floor(x / CHUNK_SIZE), cy: Math.floor(y / CHUNK_SIZE) }; }
    function getPixel(x, y) {
        const { cx, cy } = getChunkCoords(x, y);
        const key = chunkKey(cx, cy);
        const chunk = boardChunks[key];
        if (!chunk) return 0;
        const localX = x - cx * CHUNK_SIZE;
        const localY = y - cy * CHUNK_SIZE;
        const idx = localY * CHUNK_SIZE + localX;
        return charToIdx(chunk[idx]);
    }

    function renderChunk(cx, cy) {
        const key = chunkKey(cx, cy);
        const chunk = boardChunks[key];
        if (!chunk) return;
        const startX = cx * CHUNK_SIZE;
        const startY = cy * CHUNK_SIZE;
        for (let y = 0; y < CHUNK_SIZE; y++) {
            for (let x = 0; x < CHUNK_SIZE; x++) {
                const idx = y * CHUNK_SIZE + x;
                const colorIdx = charToIdx(chunk[idx]);
                if (colorIdx < palette.length) {
                    ctx.fillStyle = palette[colorIdx].hex;
                } else {
                    ctx.fillStyle = "#000000";
                }
                ctx.fillRect(startX + x, startY + y, 1, 1);
            }
        }
    }
    function clearChunk(cx, cy) {
        const startX = cx * CHUNK_SIZE;
        const startY = cy * CHUNK_SIZE;
        ctx.clearRect(startX, startY, CHUNK_SIZE, CHUNK_SIZE);
    }

    const activeChunkSubs = {};
    function subscribeChunk(cx, cy) {
        const key = chunkKey(cx, cy);
        if (activeChunkSubs[key]) return;
        const ref = chunksRef.child(key);
        const callback = snap => {
            const val = snap.val();
            if (val && typeof val === 'string' && val.length === CHUNK_SIZE * CHUNK_SIZE) {
                boardChunks[key] = val;
                renderChunk(cx, cy);
            } else {
                boardChunks[key] = new Array(CHUNK_SIZE * CHUNK_SIZE).fill(0).map(idxToChar).join('');
                renderChunk(cx, cy);
            }
        };
        ref.on('value', callback);
        activeChunkSubs[key] = { ref, callback };
    }
    function unsubscribeChunk(cx, cy) {
        const key = chunkKey(cx, cy);
        const sub = activeChunkSubs[key];
        if (sub) {
            sub.ref.off('value', sub.callback);
            delete activeChunkSubs[key];
            clearChunk(cx, cy);
        }
    }
    function getVisibleChunks() {
        const rect = viewport.getBoundingClientRect();
        const invZoom = 1 / zoom;
        const left = (-panX) * invZoom / CELL;
        const top = (-panY) * invZoom / CELL;
        const right = (rect.width - panX) * invZoom / CELL;
        const bottom = (rect.height - panY) * invZoom / CELL;
        const minX = Math.max(0, Math.floor(left));
        const minY = Math.max(0, Math.floor(top));
        const maxX = Math.min(W - 1, Math.ceil(right));
        const maxY = Math.min(H - 1, Math.ceil(bottom));
        const chunks = new Set();
        const startCX = Math.floor(minX / CHUNK_SIZE);
        const startCY = Math.floor(minY / CHUNK_SIZE);
        const endCX = Math.floor(maxX / CHUNK_SIZE);
        const endCY = Math.floor(maxY / CHUNK_SIZE);
        for (let cy = startCY; cy <= endCY; cy++) {
            for (let cx = startCX; cx <= endCX; cx++) {
                if (cx >= 0 && cx < CHUNKS_X && cy >= 0 && cy < CHUNKS_Y) {
                    chunks.add(chunkKey(cx, cy));
                }
            }
        }
        return chunks;
    }
    function updateVisibleChunks() {
        const visible = getVisibleChunks();
        for (const key of visible) {
            const [cy, cx] = key.split('_').map(Number);
            subscribeChunk(cx, cy);
        }
        for (const key in activeChunkSubs) {
            if (!visible.has(key)) {
                const [cy, cx] = key.split('_').map(Number);
                unsubscribeChunk(cx, cy);
            }
        }
    }

    let zoom = 1, panX = 0, panY = 0;
    function applyTransform() {
        const t = `translate(${panX}px, ${panY}px) scale(${zoom})`;
        canvas.style.transform = t;
        overlay.style.transform = t;
        updateVisibleChunks();
    }
    function fitToViewport() {
        const vw = viewport.clientWidth, vh = viewport.clientHeight;
        const boardW = W * CELL, boardH = H * CELL;
        zoom = Math.min(vw / boardW, vh / boardH) * 0.92;
        zoom = Math.max(0.1, Math.min(zoom, 20));
        panX = (vw - boardW * zoom) / 2;
        panY = (vh - boardH * zoom) / 2;
        applyTransform();
    }

    let hoverCell = null;
    function drawHoverOverlay() {
        overlayCtx.clearRect(0, 0, W, H);
        if (!hoverCell || isDragging) return;
        const { x, y } = hoverCell;
        const waiting = Date.now() < cooldownUntil;
        overlayCtx.fillStyle = hexToRgba(palette[selectedColor].hex, waiting ? 0.32 : 0.6);
        overlayCtx.fillRect(x, y, 1, 1);
        overlayCtx.lineWidth = 0.14;
        overlayCtx.strokeStyle = waiting ? "#ff6f67" : "#5b8dff";
        overlayCtx.strokeRect(x + 0.07, y + 0.07, 0.86, 0.86);
    }

    let cooldownUntil = 0;
    function updateCooldownDisplay() {
        const now = Date.now();
        if (now >= cooldownUntil) {
            cooldownTimeEl.textContent = "LISTO";
            cooldownTimeEl.classList.add("ready");
        } else {
            const remaining = Math.ceil((cooldownUntil - now) / 1000);
            cooldownTimeEl.textContent = "0:" + String(remaining).padStart(2, "0");
            cooldownTimeEl.classList.remove("ready");
        }
    }
    setInterval(updateCooldownDisplay, 250);

    let isPointerDown = false, isDragging = false;
    let startClientX = 0, startClientY = 0, startPanX = 0, startPanY = 0;
    const DRAG_THRESHOLD = 5;

    canvas.addEventListener("pointerdown", (e) => {
        isPointerDown = true; isDragging = false;
        startClientX = e.clientX; startClientY = e.clientY;
        startPanX = panX; startPanY = panY;
        canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener("pointermove", (e) => {
        if (isPointerDown) {
            const dx = e.clientX - startClientX, dy = e.clientY - startClientY;
            if (!isDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
                isDragging = true;
                viewport.classList.add("dragging");
                drawHoverOverlay();
            }
            if (isDragging) {
                panX = startPanX + dx; panY = startPanY + dy;
                applyTransform();
            }
        }
        const cell = clientToCell(e.clientX, e.clientY);
        if (cell) {
            hoverCell = cell;
            drawHoverOverlay();
        } else {
            hoverCell = null;
            drawHoverOverlay();
        }
    });

    function endPointer(e) {
        if (isPointerDown && !isDragging) {
            const cell = clientToCell(e.clientX, e.clientY);
            if (cell) placePixel(cell.x, cell.y);
        }
        isPointerDown = false; isDragging = false;
        viewport.classList.remove("dragging");
        drawHoverOverlay();
    }
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", () => {
        isPointerDown = false; isDragging = false;
        viewport.classList.remove("dragging");
        drawHoverOverlay();
    });
    canvas.addEventListener("pointerleave", () => {
        hoverCell = null;
        drawHoverOverlay();
    });

    viewport.addEventListener("wheel", (e) => {
        e.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
        const prevZoom = zoom;
        const factor = e.deltaY < 0 ? 1.15 : 1/1.15;
        zoom = Math.max(0.1, Math.min(zoom * factor, 20));
        panX = cx - (cx - panX) * (zoom / prevZoom);
        panY = cy - (cy - panY) * (zoom / prevZoom);
        applyTransform();
    }, { passive: false });

    document.getElementById("zoomIn").addEventListener("click", () => {
        zoom = Math.min(zoom * 1.25, 20); applyTransform();
    });
    document.getElementById("zoomOut").addEventListener("click", () => {
        zoom = Math.max(zoom / 1.25, 0.1); applyTransform();
    });
    document.getElementById("zoomFit").addEventListener("click", fitToViewport);

    window.addEventListener("resize", () => {
        if (zoom < 0.11) fitToViewport();
        else updateVisibleChunks();
    });

    // ❌ Bloquear F12 y otras teclas de desarrollo
    window.addEventListener("keydown", function(e) {
        if (e.key === "F12" || (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J" || e.key === "C")) || (e.ctrlKey && e.key === "u")) {
            e.preventDefault();
            return false;
        }
    });

    function clientToCell(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const relX = (clientX - rect.left) / rect.width;
        const relY = (clientY - rect.top) / rect.height;
        if (relX < 0 || relX >= 1 || relY < 0 || relY >= 1) return null;
        return { x: Math.floor(relX * W), y: Math.floor(relY * H) };
    }

    async function placePixel(x, y) {
        if (!auth.currentUser) {
            showToast("Iniciando sesión anónima...", true);
            await auth.signInAnonymously();
            if (!auth.currentUser) {
                showToast("Error de autenticación", true);
                return;
            }
        }
        if (Date.now() < cooldownUntil) {
            const wait = Math.ceil((cooldownUntil - Date.now()) / 1000);
            showToast(`Debes esperar ${wait}s`, true);
            return;
        }

        const { cx, cy } = getChunkCoords(x, y);
        const key = chunkKey(cx, cy);
        const localX = x - cx * CHUNK_SIZE;
        const localY = y - cy * CHUNK_SIZE;
        const idx = localY * CHUNK_SIZE + localX;

        let chunk = boardChunks[key];
        if (!chunk) chunk = new Array(CHUNK_SIZE * CHUNK_SIZE).fill(0).map(idxToChar).join("");
        const oldChar = chunk[idx];
        chunk = chunk.substring(0, idx) + idxToChar(selectedColor) + chunk.substring(idx + 1);
        boardChunks[key] = chunk;
        renderChunk(cx, cy);

        const previousCooldownUntil = cooldownUntil;
        cooldownUntil = Date.now() + COOLDOWN_MS;
        updateCooldownDisplay();
        drawHoverOverlay();

        const updates = {};
        updates[`lienzo/chunks/${key}`] = chunk;
        updates[`lienzo/cooldowns/${auth.currentUser.uid}/lastPlacement`] = firebase.database.ServerValue.TIMESTAMP;

        const countSnap = await countRef.once("value");
        const currentCount = countSnap.val() || 0;
        updates[`lienzo/count`] = currentCount + 1;
        updates[`lienzo/activity`] = {
            x: x,
            y: y,
            c: selectedColor,
            t: firebase.database.ServerValue.TIMESTAMP
        };

        try {
            await db.ref().update(updates);
            showToast(`Píxel colocado en (${x}, ${y})`);
        } catch (e) {
            chunk = chunk.substring(0, idx) + oldChar + chunk.substring(idx + 1);
            boardChunks[key] = chunk;
            renderChunk(cx, cy);
            cooldownUntil = previousCooldownUntil;
            updateCooldownDisplay();
            drawHoverOverlay();
            showToast("Error al colocar píxel", true);
        }
    }

    function showToast(msg, warn = false, isNotification = false, isHTML = false) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        if (warn) toast.classList.add('warn');
        if (isNotification) toast.classList.add('notification');
        if (isHTML) {
            toast.innerHTML = msg;
        } else {
            toast.textContent = msg;
        }
        toastContainer.prepend(toast);
        const duration = isNotification ? 10000 : 2200;
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(-5px)';
                setTimeout(() => { if (toast.parentNode) toast.remove(); }, 300);
            }
        }, duration);
    }

    function getLastKnownKey() { return localStorage.getItem(LAST_NOTIF_KEY) || null; }
    function setLastKnownKey(key) { localStorage.setItem(LAST_NOTIF_KEY, key); }

    notifRef.orderByKey().limitToLast(1).once('value', snapshot => {
        let lastKey = null;
        snapshot.forEach(child => { lastKey = child.key; });
        setLastKnownKey(lastKey);
        notifRef.on('child_added', snap => {
            const newKey = snap.key;
            const lastKnown = getLastKnownKey();
            if (lastKnown === null || newKey > lastKnown) {
                const val = snap.val();
                if (val && val.persona && val.texto) {
                    const personaEscaped = escapeHtml(val.persona);
                    const textoEscaped = escapeHtml(val.texto);
                    const mensajeHTML = `🔔 <strong>${personaEscaped}</strong>: ${textoEscaped}`;
                    showToast(mensajeHTML, false, true, true);
                }
                setLastKnownKey(newKey);
            }
        });
    });

    // ---------- SINCRONIZACIÓN GLOBAL ----------
    countRef.on('value', snap => {
        const val = snap.val();
        if (val !== null) placementCountEl.textContent = parseInt(val, 10).toLocaleString("es-ES");
    });
    activityRef.on('value', snap => {
        const val = snap.val();
        if (val) {
            try {
                const a = typeof val === 'string' ? JSON.parse(val) : val;
                const secs = Math.max(0, Math.round((Date.now() - a.t) / 1000));
                let when = secs < 60 ? `hace ${secs}s` : `hace ${Math.round(secs / 60)}min`;
                lastActivityMetaEl.textContent = `Última: (${a.x},${a.y}) ${when}`;
            } catch (e) {}
        }
    });
    db.ref('.info/connected').on('value', snap => {
        if (snap.val() === true) syncText.textContent = "Conectado · visible para todos";
        else syncText.textContent = "Sin conexión";
    });

    fitToViewport();
    updateVisibleChunks();
})();