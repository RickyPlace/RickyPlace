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
    // NOTA DE SEGURIDAD: lienzo/adminUid ahora es de solo lectura para el cliente
    // (".write": false en las reglas). Solo se puede fijar manualmente desde la
    // consola de Firebase (Realtime Database > lienzo > adminUid). Así nadie puede
    // auto-nombrarse admin desde el navegador.
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
    const notifRef = db.ref('lienzo/notifications');

    const LAST_NOTIF_KEY = 'splace_last_notification_key';
    const LOCAL_CUSTOM_COLORS_KEY = 'rickyplace_custom_colors';

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

    let fullPalette = [...basePalette];
    const colorIndexMap = new Map();

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
    const paletteBar = document.getElementById("paletteBar");
    // Admin
    const adminImportBtn = document.getElementById("adminImportBtn");
    const importImageFile = document.getElementById("importImageFile");
    const adminClearBtn = document.getElementById("adminClearBtn");
    // Controles flotantes
    const imageFloatControls = document.getElementById("imageFloatControls");
    const confirmImageFloatBtn = document.getElementById("confirmImageFloatBtn");
    const cancelImageFloatBtn = document.getElementById("cancelImageFloatBtn");

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
    function rebuildColorIndexMap() {
        colorIndexMap.clear();
        fullPalette.forEach((c, i) => colorIndexMap.set(c.hex, i));
    }

    function createSwatch(index) {
        const sw = document.createElement("div");
        sw.className = "swatch" + (index === selectedColor ? " selected" : "");
        sw.style.background = fullPalette[index].hex;
        sw.title = fullPalette[index].name || fullPalette[index].hex;
        sw.addEventListener("click", () => {
            selectedColor = index;
            document.querySelectorAll(".swatch").forEach(s => s.classList.remove("selected"));
            sw.classList.add("selected");
            selectedColorNameEl.textContent = fullPalette[index].name || fullPalette[index].hex;
            drawHoverOverlay();
        });
        return sw;
    }

    function rebuildPaletteUI() {
        paletteEl.innerHTML = "";
        for (let i = 0; i < fullPalette.length; i++) {
            paletteEl.appendChild(createSwatch(i));
        }
        if (selectedColor >= fullPalette.length) selectedColor = 0;
        selectedColorNameEl.textContent = fullPalette[selectedColor]?.name || "Blanco";
    }

    // Los colores personalizados son LOCALES: solo los ve, en su barra de paleta,
    // la persona que los creó (guardados en localStorage de su navegador). No se
    // sincronizan por Firebase ni los ve nadie más en su paleta.
    //
    // Pero cuando esa persona pinta un píxel con un color custom, el píxel se
    // guarda en el lienzo compartido con el HEX exacto dentro de la propia celda
    // (en vez de un índice de paleta), así que TODO el mundo ve ese color en el
    // lienzo perfectamente, aunque no lo tenga en su paleta local. Ver placePixel()
    // y renderChunk() para el detalle de esta codificación.
    function saveLocalCustomColors() {
        try {
            const customs = fullPalette.slice(basePalette.length).map(c => c.hex);
            localStorage.setItem(LOCAL_CUSTOM_COLORS_KEY, JSON.stringify(customs));
        } catch (e) {
            console.error("No se pudo guardar la paleta local", e);
        }
    }

    function addColorToPalette(hex) {
        const upperHex = hex.toUpperCase();
        if (colorIndexMap.has(upperHex)) {
            const idx = colorIndexMap.get(upperHex);
            selectedColor = idx;
            document.querySelectorAll(".swatch").forEach(s => s.classList.remove("selected"));
            const sw = paletteEl.children[idx];
            if (sw) sw.classList.add("selected");
            selectedColorNameEl.textContent = fullPalette[idx].name || fullPalette[idx].hex;
            return true;
        }
        if (fullPalette.length >= CHARS.length) {
            alert("Se alcanzó el máximo de colores en tu paleta (62).");
            return false;
        }
        const newColor = { hex: upperHex, name: upperHex };
        fullPalette.push(newColor);
        colorIndexMap.set(upperHex, fullPalette.length - 1);
        paletteEl.appendChild(createSwatch(fullPalette.length - 1));
        saveLocalCustomColors();
        return true;
    }

    function loadCustomPalette() {
        fullPalette = [...basePalette];
        colorIndexMap.clear();
        fullPalette.forEach((c, i) => colorIndexMap.set(c.hex, i));
        try {
            const raw = localStorage.getItem(LOCAL_CUSTOM_COLORS_KEY);
            const customs = raw ? JSON.parse(raw) : [];
            customs.forEach(hex => {
                if (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex) && fullPalette.length < CHARS.length) {
                    const upperHex = hex.toUpperCase();
                    if (!colorIndexMap.has(upperHex)) {
                        fullPalette.push({ hex: upperHex, name: upperHex });
                        colorIndexMap.set(upperHex, fullPalette.length - 1);
                    }
                }
            });
        } catch (e) {
            console.error("No se pudo cargar la paleta local", e);
        }
        rebuildPaletteUI();
        return Promise.resolve();
    }

    // Scroll horizontal con rueda en la barra de paleta
    paletteBar.addEventListener('wheel', (e) => {
        e.preventDefault();
        paletteBar.scrollLeft += e.deltaY;
    }, { passive: false });

    // Añadir color manual
    addCustomColorBtn.addEventListener("click", () => {
        const hex = customColorInput.value.trim();
        if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
            alert("Formato de color inválido. Usa #rrggbb (ej. #ff5733)");
            return;
        }
        addColorToPalette(hex);
        customColorInput.value = "";
    });

    // ---------- CHUNKS ----------
    // Cada chunk se guarda ahora como un MAPA de celdas { "x_y": "c", ... } en vez
    // de una cadena empaquetada de 10.000 caracteres. Esto permite que las Reglas
    // de Firebase validen cada escritura de forma individual (posición, formato de
    // color y cooldown), cosa que era imposible de verificar de forma segura en una
    // cadena empaquetada. Las celdas no pintadas simplemente no existen (= blanco).
    const boardChunks = {};
    function chunkKey(cx, cy) { return cy + "_" + cx; }
    function cellKey(localX, localY) { return localX + "_" + localY; }
    function getChunkCoords(x, y) { return { cx: Math.floor(x / CHUNK_SIZE), cy: Math.floor(y / CHUNK_SIZE) }; }

    // El valor de cada celda puede ser:
    //  - un solo carácter -> índice dentro de la paleta BASE (0-23, compartida por todos)
    //  - "#RRGGBB" -> un color personalizado pintado directamente con su hex exacto,
    //    así se ve igual para todo el mundo sin depender de la paleta local de nadie
    function renderChunk(cx, cy) {
        const key = chunkKey(cx, cy);
        const chunk = boardChunks[key] || {};
        const startX = cx * CHUNK_SIZE;
        const startY = cy * CHUNK_SIZE;
        for (let y = 0; y < CHUNK_SIZE; y++) {
            for (let x = 0; x < CHUNK_SIZE; x++) {
                const val = chunk[cellKey(x, y)];
                let fill = "#FFFFFF";
                if (typeof val === 'string') {
                    if (val.length === 7 && val[0] === '#') {
                        fill = val;
                    } else if (val.length === 1) {
                        const colorIdx = charToIdx(val);
                        if (colorIdx >= 0 && colorIdx < basePalette.length) {
                            fill = basePalette[colorIdx].hex;
                        }
                    }
                }
                ctx.fillStyle = fill;
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
            boardChunks[key] = (val && typeof val === 'object') ? val : {};
            renderChunk(cx, cy);
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
        const color = fullPalette[selectedColor] || fullPalette[0];
        overlayCtx.fillStyle = hexToRgba(color.hex, waiting ? 0.32 : 0.6);
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

    // ---------- IMPORTACIÓN DE IMÁGENES (admin) ----------
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
        if (imageFloatControls) imageFloatControls.style.display = 'none';
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
                    if (imageFloatControls) imageFloatControls.style.display = 'flex';
                    if (adminImportBtn) adminImportBtn.style.display = 'none';
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
            e.target.value = "";
        });
    }

    if (confirmImageFloatBtn) {
        confirmImageFloatBtn.addEventListener("click", async () => {
            if (!imagePlacementActive || !isAdmin) return;
            await placeImageOnCanvas();
        });
    }
    if (cancelImageFloatBtn) {
        cancelImageFloatBtn.addEventListener("click", () => {
            cancelImagePlacement();
        });
    }

    // Coloca la imagen escribiendo directamente cada celda afectada en un único
    // update() multi-ruta. Solo un admin puede llegar aquí (además, las reglas de
    // Firebase también exigen que auth.uid === adminUid para escribir en bloque
    // dentro de lienzo/chunks, así que aunque alguien manipulara el DOM para forzar
    // esta función, el servidor rechazaría la escritura si no es admin de verdad).
    async function placeImageOnCanvas() {
        if (!isAdmin) return;
        const w = Math.round(imageScale);
        const h = Math.round((imageToPlace.height / imageToPlace.width) * imageScale);
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = w; tempCanvas.height = h;
        const tempCtx = tempCanvas.getContext("2d");
        tempCtx.drawImage(imageToPlace, 0, 0, w, h);
        const imgData = tempCtx.getImageData(0, 0, w, h).data;

        const updates = {};
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

                // Si el color coincide exacto con uno de la paleta base, usamos su
                // índice (más compacto); si no, guardamos el hex directo del píxel.
                const baseIdx = basePalette.findIndex(c => c.hex === hex);
                const cellValue = baseIdx !== -1 ? idxToChar(baseIdx) : hex;

                const { cx, cy } = getChunkCoords(worldX, worldY);
                const ck = chunkKey(cx, cy);
                const localX = worldX - cx * CHUNK_SIZE;
                const localY = worldY - cy * CHUNK_SIZE;
                updates[`lienzo/chunks/${ck}/${cellKey(localX, localY)}`] = cellValue;

                if (!boardChunks[ck]) boardChunks[ck] = {};
                boardChunks[ck][cellKey(localX, localY)] = cellValue;
                pixelsPlaced++;
            }
        }

        if (pixelsPlaced > 0) {
            updates['lienzo/count'] = firebase.database.ServerValue.increment(pixelsPlaced);
            updates['lienzo/activity'] = {
                x: Math.round(imageX), y: Math.round(imageY),
                c: selectedColor, t: firebase.database.ServerValue.TIMESTAMP
            };
            try {
                await db.ref().update(updates);
                const touchedChunks = new Set(Object.keys(updates)
                    .filter(k => k.startsWith('lienzo/chunks/'))
                    .map(k => k.split('/')[2]));
                touchedChunks.forEach(ck => {
                    const [cy, cx] = ck.split('_').map(Number);
                    renderChunk(cx, cy);
                });
                showToast(`✅ Imagen colocada (${pixelsPlaced} píxeles)`);
            } catch (e) {
                console.error(e);
                showToast("Error al colocar la imagen", true);
            }
        }
        cancelImagePlacement();
    }

    // Limpiar lienzo (admin) — borra todo el nodo de chunks de golpe.
    // Permitido por las reglas solo si auth.uid === adminUid.
    if (adminClearBtn) {
        adminClearBtn.addEventListener("click", async () => {
            if (!isAdmin) return;
            if (!confirm("⚠️ ¿Seguro que quieres borrar TODO el lienzo?")) return;
            try {
                await chunksRef.remove();
                await countRef.set(0);
                await activityRef.set({ x: 0, y: 0, c: 0, t: firebase.database.ServerValue.TIMESTAMP });
                for (const key in boardChunks) delete boardChunks[key];
                ctx.clearRect(0, 0, W, H);
                Object.keys(activeChunkSubs).forEach(key => {
                    const [cy, cx] = key.split('_').map(Number);
                    renderChunk(cx, cy);
                });
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

    // ---------- COLOCAR PÍXEL ----------
    // Se escribe directamente en lienzo/chunks (ya no hay cola intermedia: nunca
    // había nada que la procesara). El cooldown se aplica de verdad en el
    // servidor: el píxel y la actualización del cooldown viajan en el MISMO
    // update() multi-ruta, y las Reglas de Firebase exigen que el cooldown
    // anterior ya hubiera expirado antes de aceptar el nuevo. Así, aunque alguien
    // manipule las variables de JS en el navegador, el servidor rechaza el
    // intento de saltarse la espera.
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

        const { cx, cy } = getChunkCoords(x, y);
        const ck = chunkKey(cx, cy);
        const localX = x - cx * CHUNK_SIZE;
        const localY = y - cy * CHUNK_SIZE;
        // Paleta base (compartida) -> guardamos el índice como un solo carácter.
        // Color custom (local) -> guardamos el hex exacto, así todo el mundo lo ve igual.
        const cellValue = selectedColor < basePalette.length
            ? idxToChar(selectedColor)
            : fullPalette[selectedColor].hex;
        const uid = auth.currentUser.uid;

        const updates = {};
        updates[`lienzo/chunks/${ck}/${cellKey(localX, localY)}`] = cellValue;
        updates['lienzo/count'] = firebase.database.ServerValue.increment(1);
        updates['lienzo/activity'] = { x, y, c: selectedColor, t: firebase.database.ServerValue.TIMESTAMP };
        if (!isAdmin) {
            updates[`lienzo/cooldowns/${uid}`] = Date.now() + COOLDOWN_MS;
        }

        try {
            await db.ref().update(updates);

            if (!boardChunks[ck]) boardChunks[ck] = {};
            boardChunks[ck][cellKey(localX, localY)] = cellValue;

            if (!isAdmin) {
                cooldownUntil = Date.now() + COOLDOWN_MS;
            }
            updateCooldownDisplay();
            drawHoverOverlay();

            showToast(`Píxel colocado en (${x}, ${y})`);
        } catch (e) {
            console.error(e);
            showToast("No se pudo colocar el píxel (¿cooldown activo?)", true);
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
    // lienzo/notifications es de solo lectura para el cliente (se añade desde la
    // consola de Firebase o un proceso propio); así no puede usarse para inyectar
    // HTML arbitrario desde el navegador. De todos modos, el texto siempre pasa
    // por escapeHtml() antes de insertarse en el DOM.
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

    // Iniciar paleta y vista
    loadCustomPalette().then(() => {
        fitToViewport();
        updateVisibleChunks();
    });
})();