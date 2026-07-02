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

    // ---------- ESTADO DE ADMIN ----------
    let isAdmin = false;
    const userUidDisplay = document.getElementById('userUidDisplay');
    if (userUidDisplay) {
        auth.onAuthStateChanged(user => {
            if (user) {
                userUidDisplay.textContent = user.uid.substring(0, 8) + '…';
                userUidDisplay.title = 'Haz clic para copiar tu UID completo';
                userUidDisplay.addEventListener('click', () => {
                    navigator.clipboard.writeText(user.uid);
                    showToast('✅ UID copiado al portapapeles');
                });
            }
        });
    }

    const adminPanel = document.getElementById('adminPanel');
    db.ref('lienzo/adminUid').on('value', snap => {
        const adminUid = snap.val();
        if (auth.currentUser && auth.currentUser.uid === adminUid) {
            isAdmin = true;
            if (adminPanel) adminPanel.style.display = 'flex';
        } else {
            isAdmin = false;
            if (adminPanel) adminPanel.style.display = 'none';
            if (imagePlacementActive) cancelImagePlacement();
        }
        updateCooldownDisplay();
    });

    // ---------- CONFIG DEL LIENZO ----------
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

    // ---------- DOM ----------
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
    // Admin
    const adminImportBtn = document.getElementById("adminImportBtn");
    const importImageFile = document.getElementById("importImageFile");
    const adminClearBtn = document.getElementById("adminClearBtn");
    // Controles de colocación
    const imagePlacementControls = document.getElementById("imagePlacementControls");
    const confirmImageBtn = document.getElementById("confirmImageBtn");
    const cancelImageBtn = document.getElementById("cancelImageBtn");

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
    let cooldownUntil = 0;

    // ---------- PALETA ----------
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
        const newColor = { hex: hex, name: hex };
        const index = palette.length;
        palette.push(newColor);
        colorIndexMap.set(hex, index);
        paletteEl.appendChild(createSwatch(newColor, index));
        customColorInput.value = "";
    });

    // ---------- CHUNKS ----------
    const boardChunks = {};
    function chunkKey(cx, cy) { return cy + "_" + cx; }
    function getChunkCoords(x, y) { return { cx: Math.floor(x / CHUNK_SIZE), cy: Math.floor(y / CHUNK_SIZE) }; }

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
    let isDragging = false;

    function hexToRgba(hex, a) {
        const v = hex.replace("#","");
        const r = parseInt(v.substring(0,2),16), g = parseInt(v.substring(2,4),16), b = parseInt(v.substring(4,6),16);
        return `rgba(${r},${g},${b},${a})`;
    }

    function drawHoverOverlay() {
        if (imagePlacementActive) return;
        overlayCtx.clearRect(0, 0, W, H);
        if (!hoverCell || isDragging) return;
        const { x, y } = hoverCell;
        const waiting = Date.now() < cooldownUntil && !isAdmin;
        overlayCtx.fillStyle = hexToRgba(palette[selectedColor].hex, waiting ? 0.32 : 0.6);
        overlayCtx.fillRect(x, y, 1, 1);
        overlayCtx.lineWidth = 0.14;
        overlayCtx.strokeStyle = waiting ? "#ff6f67" : "#5b8dff";
        overlayCtx.strokeRect(x + 0.07, y + 0.07, 0.86, 0.86);
    }

    function updateCooldownDisplay() {
        if (isAdmin) {
            cooldownTimeEl.textContent = "ADMIN";
            cooldownTimeEl.classList.add("ready", "admin-mode");
            return;
        }
        cooldownTimeEl.classList.remove("admin-mode");
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

    auth.onAuthStateChanged(function(user) {
        if (user) {
            syncText.textContent = "Conectado · visible para todos";
            cooldownUntil = 0;
            updateCooldownDisplay();
        } else {
            syncText.textContent = "No autenticado";
        }
    });

    // ---------- IMPORTACIÓN DE IMÁGENES (solo admin) ----------
    let imagePlacementActive = false;
    let imageToPlace = null;
    let imageScale = 100;
    let imageX = 0, imageY = 0;
    let isDraggingImage = false;
    let dragStartImageX = 0, dragStartImageY = 0;

    function drawImagePreview() {
        if (!imageToPlace || !imagePlacementActive) return;
        const w = Math.round(imageScale);
        const h = Math.round((imageToPlace.height / imageToPlace.width) * imageScale);
        overlayCtx.clearRect(0, 0, W, H);
        overlayCtx.fillStyle = "rgba(0, 0, 0, 0.5)";
        overlayCtx.fillRect(imageX, imageY, w, h);
        overlayCtx.drawImage(imageToPlace, imageX, imageY, w, h);
        overlayCtx.strokeStyle = "#5b8dff";
        overlayCtx.lineWidth = 2;
        overlayCtx.setLineDash([5, 3]);
        overlayCtx.strokeRect(imageX, imageY, w, h);
        overlayCtx.setLineDash([]);
    }

    function cancelImagePlacement() {
        imagePlacementActive = false;
        imageToPlace = null;
        viewport.style.cursor = "grab";
        overlayCtx.clearRect(0, 0, W, H);
        drawHoverOverlay();
        if (imagePlacementControls) imagePlacementControls.style.display = 'none';
        if (adminImportBtn) adminImportBtn.style.display = 'inline-block';
    }

    if (adminImportBtn) {
        adminImportBtn.addEventListener("click", () => {
            if (!isAdmin) return;
            importImageFile.click();
        });
    }

    if (importImageFile) {
        importImageFile.addEventListener("change", (e) => {
            if (!isAdmin) return;
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    imageToPlace = img;
                    imageScale = Math.min(200, img.width);
                    imageX = (W - imageScale) / 2;
                    imageY = (H - (img.height / img.width * imageScale)) / 2;
                    imagePlacementActive = true;
                    viewport.style.cursor = "move";
                    drawImagePreview();
                    // Mostrar controles de colocación
                    if (imagePlacementControls) imagePlacementControls.style.display = 'flex';
                    if (adminImportBtn) adminImportBtn.style.display = 'none';
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
            e.target.value = "";
        });
    }

    // Confirmar colocación
    if (confirmImageBtn) {
        confirmImageBtn.addEventListener("click", async () => {
            if (!imagePlacementActive || !isAdmin) return;
            await placeImageOnCanvas();
        });
    }
    if (cancelImageBtn) {
        cancelImageBtn.addEventListener("click", () => {
            cancelImagePlacement();
        });
    }

    async function placeImageOnCanvas() {
        const w = Math.round(imageScale);
        const h = Math.round((imageToPlace.height / imageToPlace.width) * imageScale);
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = w; tempCanvas.height = h;
        const tempCtx = tempCanvas.getContext("2d");
        tempCtx.drawImage(imageToPlace, 0, 0, w, h);
        const imgData = tempCtx.getImageData(0, 0, w, h).data;

        const modifiedChunks = {};
        let pixelsPlaced = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                const r = imgData[idx], g = imgData[idx+1], b = imgData[idx+2], a = imgData[idx+3];
                if (a < 128) continue;
                const hex = "#" + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
                const worldX = Math.round(imageX + x);
                const worldY = Math.round(imageY + y);
                if (worldX < 0 || worldX >= W || worldY < 0 || worldY >= H) continue;
                const { cx, cy } = getChunkCoords(worldX, worldY);
                const key = chunkKey(cx, cy);
                if (!modifiedChunks[key]) {
                    let chunk = boardChunks[key];
                    modifiedChunks[key] = chunk ? chunk.split('') : new Array(CHUNK_SIZE * CHUNK_SIZE).fill(0).map(idxToChar).join('').split('');
                }
                const localX = worldX - cx * CHUNK_SIZE;
                const localY = worldY - cy * CHUNK_SIZE;
                let colorIdx = colorIndexMap.has(hex) ? colorIndexMap.get(hex) : 0;
                modifiedChunks[key][localY * CHUNK_SIZE + localX] = idxToChar(colorIdx);
                pixelsPlaced++;
            }
        }

        for (const [key, chunkArr] of Object.entries(modifiedChunks)) {
            boardChunks[key] = chunkArr.join('');
            const [cy, cx] = key.split('_').map(Number);
            renderChunk(cx, cy);
            await chunksRef.child(key).set(boardChunks[key]);
        }

        if (pixelsPlaced > 0) {
            const countSnap = await countRef.once("value");
            await countRef.set((countSnap.val() || 0) + pixelsPlaced);
            showToast(`✅ Imagen colocada (${pixelsPlaced} píxeles)`);
        }
        cancelImagePlacement();
    }

    // Limpiar lienzo (admin)
    if (adminClearBtn) {
        adminClearBtn.addEventListener("click", async () => {
            if (!isAdmin) return;
            if (!confirm("⚠️ ¿Seguro que quieres borrar TODO el lienzo?")) return;
            try {
                // Primero eliminar todos los chunks
                for (let cy = 0; cy < CHUNKS_Y; cy++) {
                    for (let cx = 0; cx < CHUNKS_X; cx++) {
                        await chunksRef.child(`${cy}_${cx}`).set(new Array(CHUNK_SIZE * CHUNK_SIZE).fill(0).map(idxToChar).join(''));
                    }
                }
                // Reiniciar contador y actividad
                await countRef.set(0);
                await activityRef.set({ x: 0, y: 0, c: 0, t: firebase.database.ServerValue.TIMESTAMP });
                // Limpiar variables locales
                for (const key in boardChunks) delete boardChunks[key];
                ctx.clearRect(0, 0, W, H);
                showToast("🗑️ Lienzo limpiado");
            } catch (e) {
                showToast("Error al limpiar el lienzo", true);
                console.error(e);
            }
        });
    }

    // ---------- EVENTOS DE RATÓN ----------
    let isPointerDown = false;
    let startClientX = 0, startClientY = 0, startPanX = 0, startPanY = 0;
    const DRAG_THRESHOLD = 5;

    canvas.addEventListener("pointerdown", (e) => {
        if (imagePlacementActive && isAdmin) {
            isPointerDown = true;
            isDraggingImage = false;
            startClientX = e.clientX;
            startClientY = e.clientY;
            dragStartImageX = imageX;
            dragStartImageY = imageY;
            canvas.setPointerCapture(e.pointerId);
            e.preventDefault();
            return;
        }
        isPointerDown = true; isDragging = false;
        startClientX = e.clientX; startClientY = e.clientY;
        startPanX = panX; startPanY = panY;
        canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener("pointermove", (e) => {
        if (imagePlacementActive && isAdmin && isPointerDown) {
            const dx = e.clientX - startClientX;
            const dy = e.clientY - startClientY;
            if (!isDraggingImage && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
                isDraggingImage = true;
            }
            if (isDraggingImage) {
                imageX = dragStartImageX + dx / zoom;
                imageY = dragStartImageY + dy / zoom;
                drawImagePreview();
            }
            return;
        }

        if (isPointerDown && !imagePlacementActive) {
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
        if (cell && !imagePlacementActive) {
            hoverCell = cell;
            drawHoverOverlay();
        } else if (!imagePlacementActive) {
            hoverCell = null;
            drawHoverOverlay();
        }
    });

    function endPointer(e) {
        if (imagePlacementActive && isAdmin) {
            isPointerDown = false;
            isDraggingImage = false;
            canvas.releasePointerCapture(e.pointerId);
            return;
        }

        if (isPointerDown && !isDragging && !imagePlacementActive) {
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
        isDraggingImage = false;
        viewport.classList.remove("dragging");
        drawHoverOverlay();
    });
    canvas.addEventListener("pointerleave", () => {
        if (imagePlacementActive) return;
        hoverCell = null;
        drawHoverOverlay();
    });

    viewport.addEventListener("wheel", (e) => {
        e.preventDefault();
        if (imagePlacementActive && isAdmin) {
            const scaleFactor = e.deltaY < 0 ? 1.08 : 1/1.08;
            imageScale = Math.max(5, Math.min(500, imageScale * scaleFactor));
            drawImagePreview();
            return;
        }
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
        if (imagePlacementActive) return;
        zoom = Math.min(zoom * 1.25, 20); applyTransform();
    });
    document.getElementById("zoomOut").addEventListener("click", () => {
        if (imagePlacementActive) return;
        zoom = Math.max(zoom / 1.25, 0.1); applyTransform();
    });
    document.getElementById("zoomFit").addEventListener("click", fitToViewport);

    window.addEventListener("resize", () => {
        if (zoom < 0.11) fitToViewport();
        else updateVisibleChunks();
    });

    function clientToCell(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const relX = (clientX - rect.left) / rect.width;
        const relY = (clientY - rect.top) / rect.height;
        if (relX < 0 || relX >= 1 || relY < 0 || relY >= 1) return null;
        return { x: Math.floor(relX * W), y: Math.floor(relY * H) };
    }

    // ---------- COLOCAR PÍXEL (ENCOLAR) ----------
    async function placePixel(x, y) {
        if (!auth.currentUser) {
            showToast("Iniciando sesión anónima...", true);
            await auth.signInAnonymously();
            if (!auth.currentUser) {
                showToast("Error de autenticación", true);
                return;
            }
        }

        if (!isAdmin && Date.now() < cooldownUntil) {
            const wait = Math.ceil((cooldownUntil - Date.now()) / 1000);
            showToast(`Debes esperar ${wait}s`, true);
            return;
        }

        const queueRef = db.ref('lienzo/pixelQueue');
        try {
            await queueRef.push({
                x: x,
                y: y,
                colorIndex: selectedColor,
                uid: auth.currentUser.uid
            });

            if (!isAdmin) {
                cooldownUntil = Date.now() + COOLDOWN_MS;
            }
            updateCooldownDisplay();
            drawHoverOverlay();

            showToast(`Píxel encolado en (${x}, ${y})`);
        } catch (e) {
            showToast("Error al encolar píxel", true);
        }
    }

    // ---------- TOASTS ----------
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

    function escapeHtml(unsafe) {
        return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    // ---------- NOTIFICACIONES ----------
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