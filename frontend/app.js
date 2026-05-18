// SS Gas Control - Logic
let supabaseClient;
let currentUser = null;
let currentCoords = null;
let isDirty = false;
let allClients = [];

async function initSupabase() {
    try {
        const response = await fetch('/api/config');
        const config = await response.json();
        supabaseClient = window.supabase.createClient(config.url, config.key);
        supabaseClient.auth.onAuthStateChange((event, session) => {
            if (session) handleAuthSuccess(session.user);
            else { showView('login-view'); document.getElementById('main-header').style.display = 'none'; }
        });
        setupEventListeners();
        restoreDraft();
    } catch (err) { console.error("Erro init:", err); }
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

function setupEventListeners() {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.onsubmit = async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) showToast("Erro: " + error.message, "error");
        };
    }
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.onclick = async () => { await supabaseClient.auth.signOut(); location.reload(); };

    const clientDoc = document.getElementById('client-doc');
    if (clientDoc) {
        clientDoc.oninput = (e) => {
            const val = e.target.value.replace(/\D/g, '');
            if (val.length >= 11) searchClient(val);
            saveDraft();
        };
    }
    document.getElementById('add-item').onclick = () => { addItem(); saveDraft(); };
    document.getElementById('delivery-form').onsubmit = async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => { currentCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude }; submitDelivery(btn, originalText); },
                () => { showToast("Sem GPS.", "info"); submitDelivery(btn, originalText); },
                { timeout: 5000 }
            );
        } else { submitDelivery(btn, originalText); }
    };
}

function handleAuthSuccess(user) {
    currentUser = user;
    document.getElementById('main-header').style.display = 'block';
    const isAdmin = user.email.includes('admin') || user.email === 'comercial@servweld.com.br';
    const adminCard = document.getElementById('admin-card');
    if (adminCard) adminCard.style.display = isAdmin ? 'flex' : 'none';
    const nameEl = document.getElementById('user-display-name');
    if (nameEl) nameEl.innerText = user.email.split('@')[0];
    
    // Restaurar a última tela visualizada
    const savedView = localStorage.getItem('active_view');
    if (savedView) {
        showView(savedView);
    } else if (localStorage.getItem('gas_draft')) {
        showView('driver-view');
    } else {
        showView('home-view');
    }
}

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.style.display = 'none'; });
    const view = document.getElementById(viewId);
    if (view) { view.classList.add('active'); view.style.display = 'block'; }
    
    // Salvar a tela atual para persistência
    localStorage.setItem('active_view', viewId);
    
    if (viewId === 'history-view') loadHistory();
    if (viewId === 'clients-view') loadClients();
}

let itemCounter = 0;
function addItem(data = null) {
    const container = document.getElementById('items-container');
    const div = document.createElement('div');
    div.className = 'card item-card';
    div.style.marginBottom = '1rem';
    const id = ++itemCounter;
    div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <b>Cilindro #${id}</b>
            <button type="button" onclick="this.closest('.item-card').remove(); saveDraft();" style="color:red; border:none; background:none; font-size:1.2rem;">&times;</button>
        </div>
        <div class="filter-grid" style="margin-top:0.5rem;">
            <select class="form-control" name="tipo_gas" onchange="saveDraft()">
                <option value="Oxigênio">Oxigênio</option><option value="Acetileno">Acetileno</option>
                <option value="Argônio">Argônio</option><option value="Mistura">Mistura</option>
                <option value="CO2">CO2</option><option value="Nitrogênio">Nitrogênio</option><option value="GLP">GLP</option>
            </select>
            <input type="number" class="form-control" name="qtd" value="${data?data.qtd:1}" onchange="saveDraft()">
        </div>
        <select class="form-control" name="tamanho_gas" style="margin-top:0.5rem;" onchange="saveDraft()">
            <option value="1m3">1m³</option><option value="3m3">3m³</option><option value="7m3">7m³</option>
            <option value="10m3">10m³</option><option value="1kg">1 kg</option><option value="9kg">9 kg</option>
            <option value="13kg">13 kg</option><option value="25kg">25 kg</option><option value="45kg">45 kg</option>
        </select>
        <input type="text" class="form-control cil-obs" placeholder="Observação..." style="margin-top:0.5rem;" value="${data?data.obs:''}" oninput="saveDraft()">
        <div id="photos-${id}" style="display:grid; grid-template-columns:repeat(3,1fr); gap:5px; margin-top:5px;"></div>
        <button type="button" class="btn btn-outline" style="width:100%; margin-top:5px; font-size:0.8rem;" onclick="addPhoto(${id})">Adicionar Foto</button>
    `;
    container.appendChild(div);
    if (data) { div.querySelector('[name="tipo_gas"]').value = data.tipo_gas; div.querySelector('[name="tamanho_gas"]').value = data.tamanho_gas; }
}

function addPhoto(id) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
    input.onchange = (e) => {
        if (e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = (re) => {
                const img = document.createElement('img');
                img.src = re.target.result; img.style = "width:100%; height:60px; object-fit:cover; border-radius:4px;";
                const hiddenInput = document.createElement('input');
                hiddenInput.type = 'file'; hiddenInput.style.display = 'none'; hiddenInput.className = `photo-file-input`;
                const dt = new DataTransfer(); dt.items.add(e.target.files[0]); hiddenInput.files = dt.files;
                document.getElementById(`photos-${id}`).appendChild(img);
                document.getElementById(`photos-${id}`).appendChild(hiddenInput);
                saveDraft();
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    };
    input.click();
}

async function submitDelivery(btn, originalText) {
    const payload = {
        cnpj: document.getElementById('client-doc').value.replace(/\D/g, ''),
        nome_cliente: document.getElementById('client-name').value,
        numero_documento: document.getElementById('doc-number').value,
        data_entrega: new Date().toISOString(),
        tipo_entrega: 'motorista',
        lat: currentCoords?.lat, lng: currentCoords?.lng,
        cilindros: Array.from(document.querySelectorAll('.item-card')).map(card => ({
            tipo_gas: card.querySelector('[name="tipo_gas"]').value,
            tamanho_gas: card.querySelector('[name="tamanho_gas"]').value,
            qtd: card.querySelector('[name="qtd"]').value,
            obs: card.querySelector('.cil-obs').value
        }))
    };
    const formData = new FormData();
    formData.append('payload', JSON.stringify(payload));
    document.querySelectorAll('input[type="file"].photo-file-input').forEach(input => {
        if (input.files[0]) formData.append('fotos', input.files[0]);
    });
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch('/api/entregas', { method: 'POST', body: formData, headers: { 'Authorization': `Bearer ${session?.access_token}` } });
        if (res.ok) { showToast("Sucesso!"); localStorage.removeItem('gas_draft'); setTimeout(() => location.reload(), 1000); }
        else { showToast("Erro no envio", "error"); btn.disabled = false; btn.innerHTML = originalText; }
    } catch (err) { showToast("Erro conexão", "error"); btn.disabled = false; btn.innerHTML = originalText; }
}

async function searchClient(doc) {
    try {
        const res = await fetch(`/api/cnpj/${doc}`);
        if (res.ok) { const data = await res.json(); document.getElementById('client-name').value = data.nome_razao || ""; saveDraft(); }
    } catch (err) {}
}

async function loadHistory() {
    const resDiv = document.getElementById('history-results');
    if (!resDiv) return;
    resDiv.innerHTML = '<p style="text-align:center; padding:1rem;"><i class="fas fa-spinner fa-spin"></i> Buscando...</p>';
    
    const start = document.getElementById('filter-start')?.value || "";
    const end = document.getElementById('filter-end')?.value || "";
    const search = document.getElementById('filter-search')?.value || "";
    
    try {
        const res = await fetch(`/api/entregas/filtro?start_date=${start}&end_date=${end}&search=${encodeURIComponent(search)}`);
        if (!res.ok) throw new Error("Falha na resposta do servidor");
        
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("Formato de dados inválido");

        resDiv.innerHTML = data.map(item => `
            <div class="history-item" onclick="toggleDetails(${item.id})" style="cursor:pointer; margin-bottom:12px; border-left:4px solid var(--primary); padding:12px; background:white; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="flex:1;">
                        <h4 style="margin:0; font-size:0.95rem; color:var(--dark);">${item.cliente || "Cliente Desconhecido"}</h4>
                        <p style="margin:4px 0 0; color:#666; font-size:0.8rem;">
                            <i class="far fa-calendar-alt"></i> ${item.data ? new Date(item.data).toLocaleDateString('pt-BR') : 'Data n/a'} 
                            - <i class="fas fa-file-invoice"></i> NF: ${item.nf || 'S/N'}
                        </p>
                    </div>
                    <i class="fas fa-chevron-down" id="icon-${item.id}" style="color:#ccc;"></i>
                </div>
                <div id="details-${item.id}" style="display:none; margin-top:12px; padding-top:12px; border-top:1px solid #eee;">
                    <p style="font-size:0.85rem; font-weight:600; color:var(--primary); margin-bottom:8px;">Itens da Entrega:</p>
                    ${(item.itens || []).map(i => `
                        <div style="font-size:0.8rem; background:#f9f9f9; padding:8px; border-radius:6px; margin-bottom:6px; border:1px solid #eee;">
                            <b>${i.qtd || 1}x ${i.gas || 'Gás'} (${i.tam || 'Tam n/a'})</b>
                            ${i.obs ? `<div style="color:#777; font-size:0.75rem; margin-top:3px; font-style:italic;">Obs: ${i.obs}</div>` : ''}
                        </div>
                    `).join('') || '<p style="font-size:0.8rem; color:#999;">Sem detalhes de itens.</p>'}
                    
                    ${item.fotos && item.fotos.length > 0 ? `
                        <div style="margin-top:12px;">
                            <p style="font-size:0.85rem; font-weight:600; color:var(--dark); margin-bottom:8px;">Comprovantes:</p>
                            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                                ${item.fotos.map((link, idx) => `
                                    <button type="button" onclick="event.stopPropagation(); openImageViewer('${link}', ${idx}, ${JSON.stringify(item.fotos).replace(/"/g, '&quot;')})" class="btn btn-outline" style="font-size:0.7rem; padding:6px 12px; background:#fff; width:auto; display:inline-flex;">
                                        <i class="fas fa-image"></i> Foto ${idx + 1}
                                    </button>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `).join('') || '<p style="text-align:center; color:#999; padding:3rem;">Nenhuma entrega encontrada para este filtro.</p>';
    } catch (err) { 
        console.error("Erro no Histórico:", err);
        resDiv.innerHTML = `
            <div style="text-align:center; padding:2rem; color:var(--danger);">
                <i class="fas fa-exclamation-triangle" style="font-size:2rem; margin-bottom:1rem;"></i>
                <p>Erro ao carregar o histórico.</p>
                <small style="color:#999;">${err.message}</small>
                <button class="btn btn-outline" onclick="loadHistory()" style="margin-top:1rem; width:auto; padding:0.5rem 1rem;">Tentar Novamente</button>
            </div>
        `;
    }
}

function toggleDetails(id) {
    const details = document.getElementById(`details-${id}`);
    const icon = document.getElementById(`icon-${id}`);
    if (!details) return;
    if (details.style.display === 'none') {
        details.style.display = 'block';
        if (icon) icon.classList.replace('fa-chevron-down', 'fa-chevron-up');
    } else {
        details.style.display = 'none';
        if (icon) icon.classList.replace('fa-chevron-up', 'fa-chevron-down');
    }
}

async function loadClients() {
    try {
        const res = await fetch('/api/clientes');
        allClients = await res.json();
        renderClientsList(allClients);
    } catch (err) {}
}

function renderClientsList(clients) {
    const container = document.getElementById('clients-list-container');
    if (!container) return;
    container.innerHTML = clients.map(c => `
        <div class="list-item" style="padding:12px; border-bottom:1px solid #eee; background:white; margin-bottom:12px; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,0.05); border-left:4px solid var(--primary);">
            <h4 style="margin:0; font-size:0.95rem; color:var(--dark);">${c.nome_razao || "Sem Nome"}</h4>
            <p style="font-size:0.8rem; color:#666; margin:4px 0;"><i class="fas fa-id-card"></i> ${c.cnpj || "S/CNPJ"}</p>
            ${c.lat ? `
                <div style="margin-top: 10px; border-radius: 8px; overflow: hidden; border: 1px solid #eee; position: relative; height: 130px;">
                    <iframe 
                        width="100%" 
                        height="130" 
                        frameborder="0" 
                        scrolling="no" 
                        marginheight="0" 
                        marginwidth="0" 
                        src="https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(c.lng)-0.0015}%2C${parseFloat(c.lat)-0.0015}%2C${parseFloat(c.lng)+0.0015}%2C${parseFloat(c.lat)+0.0015}&layer=mapnik&marker=${c.lat}%2C${c.lng}"
                        style="border: 0; pointer-events: none;">
                    </iframe>
                    <div onclick="openRouteModal('${c.lat}', '${c.lng}', '${c.nome_razao.replace(/'/g, "\\'")}')" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.05); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.2s;">
                        <span class="btn btn-primary" style="font-size: 0.75rem; padding: 6px 14px; box-shadow: 0 4px 8px rgba(0,0,0,0.15); width: auto;">
                            <i class="fas fa-route"></i> Trace Rota
                        </span>
                    </div>
                </div>
            ` : `
                <p style="font-size:0.75rem; color:#999; margin-top:8px; font-style:italic;">
                    <i class="fas fa-map-marker-alt"></i> Localização não registrada para este cliente.
                </p>
            `}
        </div>
    `).join('') || '<p style="text-align:center; padding:2rem; color:#999;">Nenhum cliente cadastrado.</p>';
}

function filterClientsList() {
    const term = document.getElementById('client-search')?.value.toLowerCase() || "";
    renderClientsList(allClients.filter(c => 
        (c.nome_razao && c.nome_razao.toLowerCase().includes(term)) || 
        (c.cnpj && c.cnpj.includes(term))
    ));
}

function saveDraft() {
    isDirty = true;
    const data = {
        clientDoc: document.getElementById('client-doc')?.value || "",
        clientName: document.getElementById('client-name')?.value || "",
        docNumber: document.getElementById('doc-number')?.value || "",
        items: Array.from(document.querySelectorAll('.item-card')).map(card => ({
            tipo_gas: card.querySelector('[name="tipo_gas"]').value,
            tamanho_gas: card.querySelector('[name="tamanho_gas"]').value,
            qtd: card.querySelector('[name="qtd"]').value,
            obs: card.querySelector('.cil-obs').value
        }))
    };
    localStorage.setItem('gas_draft', JSON.stringify(data));
}

function restoreDraft() {
    const draft = localStorage.getItem('gas_draft');
    if (draft) {
        try {
            const data = JSON.parse(draft);
            if (document.getElementById('client-doc')) document.getElementById('client-doc').value = data.clientDoc || "";
            if (document.getElementById('client-name')) document.getElementById('client-name').value = data.clientName || "";
            if (document.getElementById('doc-number')) document.getElementById('doc-number').value = data.docNumber || "";
            if (data.items) data.items.forEach(item => addItem(item));
        } catch (e) { console.error("Erro restore draft:", e); }
    }
}

// Image Viewer Modal Functions
let currentViewerPhotos = [];
let currentViewerIndex = 0;

function openImageViewer(link, index, allPhotos = []) {
    currentViewerPhotos = allPhotos && allPhotos.length > 0 ? allPhotos : [link];
    currentViewerIndex = index;
    updateViewerContent();
}

function updateViewerContent() {
    const modal = document.getElementById('image-viewer-modal');
    const img = document.getElementById('viewer-img');
    const downloadBtn = document.getElementById('viewer-download');
    const counter = document.getElementById('viewer-counter');
    const prevBtn = document.getElementById('viewer-prev');
    const nextBtn = document.getElementById('viewer-next');
    
    if (modal && img && downloadBtn) {
        const currentLink = currentViewerPhotos[currentViewerIndex];
        img.src = getDisplayUrl(currentLink);
        downloadBtn.href = currentLink;
        
        if (counter) {
            counter.innerText = `Foto ${currentViewerIndex + 1} de ${currentViewerPhotos.length}`;
        }
        
        // Exibe ou oculta setas de navegação
        const showNav = currentViewerPhotos.length > 1;
        if (prevBtn) prevBtn.style.display = showNav ? 'flex' : 'none';
        if (nextBtn) nextBtn.style.display = showNav ? 'flex' : 'none';
        
        modal.style.display = 'flex';
    }
}

function navigateViewer(direction) {
    if (currentViewerPhotos.length <= 1) return;
    currentViewerIndex = (currentViewerIndex + direction + currentViewerPhotos.length) % currentViewerPhotos.length;
    updateViewerContent();
}

function closeImageViewer() {
    const modal = document.getElementById('image-viewer-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function getDisplayUrl(driveUrl) {
    if (!driveUrl) return "";
    try {
        const urlObj = new URL(driveUrl);
        const fileId = urlObj.searchParams.get("id");
        if (fileId) {
            // Retorna o thumbnail otimizado em alta definição direto do Google Drive
            return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
        }
    } catch (e) {
        console.error("Erro ao converter URL:", e);
    }
    return driveUrl;
}

function openRouteModal(lat, lng, clientName) {
    const modal = document.getElementById('route-modal');
    const gmapsLink = document.getElementById('route-google-maps');
    const wazeLink = document.getElementById('route-waze');
    
    if (modal && gmapsLink && wazeLink) {
        gmapsLink.href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
        wazeLink.href = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
        modal.style.display = 'flex';
    }
}

function closeRouteModal() {
    const modal = document.getElementById('route-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

initSupabase();
