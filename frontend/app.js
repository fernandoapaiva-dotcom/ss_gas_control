// SS Gas Control - Logic
let supabaseClient;
let currentUser = null;
let currentCoords = null;
let isDirty = false;
let allClients = [];
let preUploadedPhotos = [];

function validarCPF(cpf) {
    cpf = cpf.replace(/[^\d]+/g,'');
    if(cpf == '' || cpf.length != 11) return false;
    if (cpf == "00000000000" || cpf == "11111111111" || cpf == "22222222222" || 
        cpf == "33333333333" || cpf == "44444444444" || cpf == "55555555555" || 
        cpf == "66666666666" || cpf == "77777777777" || cpf == "88888888888" || 
        cpf == "99999999999")
        return false;
    let add = 0;
    for (let i=0; i < 9; i++) add += parseInt(cpf.charAt(i)) * (10 - i);
    let rev = 11 - (add % 11);
    if (rev == 10 || rev == 11) rev = 0;
    if (rev != parseInt(cpf.charAt(9))) return false;
    add = 0;
    for (let i = 0; i < 10; i++) add += parseInt(cpf.charAt(i)) * (11 - i);
    rev = 11 - (add % 11);
    if (rev == 10 || rev == 11) rev = 0;
    if (rev != parseInt(cpf.charAt(10))) return false;
    return true;
}

function validarCNPJ(cnpj) {
    cnpj = cnpj.replace(/[^\d]+/g,'');
    if(cnpj == '' || cnpj.length != 14) return false;
    if (cnpj == "00000000000000" || cnpj == "11111111111111" || cnpj == "22222222222222" || 
        cnpj == "33333333333333" || cnpj == "44444444444444" || cnpj == "55555555555555" || 
        cnpj == "66666666666666" || cnpj == "77777777777777" || cnpj == "88888888888888" || 
        cnpj == "99999999999999")
        return false;
    let tamanho = cnpj.length - 2;
    let numeros = cnpj.substring(0,tamanho);
    let digitos = cnpj.substring(tamanho);
    let soma = 0;
    let pos = tamanho - 7;
    for (let i = tamanho; i >= 1; i--) {
        soma += numeros.charAt(tamanho - i) * pos--;
        if (pos < 2) pos = 9;
    }
    let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
    if (resultado != digitos.charAt(0)) return false;
    tamanho = tamanho + 1;
    numeros = cnpj.substring(0,tamanho);
    soma = 0;
    pos = tamanho - 7;
    for (let i = tamanho; i >= 1; i--) {
        soma += numeros.charAt(tamanho - i) * pos--;
        if (pos < 2) pos = 9;
    }
    resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
    if (resultado != digitos.charAt(1)) return false;
    return true;
}

function preloadGPS() {
    console.log("[RASTREIO] Pré-carregando GPS...");
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                currentCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                console.log("[RASTREIO] GPS pré-carregado com sucesso:", currentCoords);
            },
            (err) => { console.warn("[RASTREIO] Falha ao pré-carregar GPS:", err.message); },
            { timeout: 8000, enableHighAccuracy: true }
        );
    }
}

async function initSupabase() {
    try {
        const response = await fetch('/api/config');
        const config = await response.json();
        supabaseClient = window.supabase.createClient(config.url, config.key);
        supabaseClient.auth.onAuthStateChange(async (event, session) => {
            if (event === 'PASSWORD_RECOVERY') {
                const newPassword = prompt("Digite sua nova senha:");
                if (newPassword) {
                    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
                    if (error) {
                        showToast("Erro ao redefinir senha: " + error.message, "error");
                    } else {
                        showToast("Senha redefinida com sucesso! Você já está logado.", "success");
                    }
                }
            }
            if (session) handleAuthSuccess(session.user, session);
            else { showView('login-view'); document.getElementById('main-header').style.display = 'none'; }
        });
        setupEventListeners();
        restoreDraft();
        initOfflineDB().catch(e => console.error("Erro IndexedDB:", e));
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
            localStorage.removeItem('active_view');
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) showToast("Erro: " + error.message, "error");
        };
    }

    const forgotPasswordLnk = document.getElementById('forgot-password-lnk');
    if (forgotPasswordLnk) {
        forgotPasswordLnk.onclick = async (e) => {
            e.preventDefault();
            const email = prompt("Digite seu e-mail cadastrado para receber o link de redefinição de senha:");
            if (email) {
                const { error } = await supabaseClient.auth.resetPasswordForEmail(email.trim(), {
                    redirectTo: window.location.origin
                });
                if (error) {
                    showToast("Erro ao enviar e-mail: " + error.message, "error");
                } else {
                    showToast("E-mail de redefinição enviado com sucesso! Verifique sua caixa de entrada.", "success");
                }
            }
        };
    }
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.onclick = async () => { 
            localStorage.removeItem('active_view'); 
            localStorage.removeItem('gas_draft');
            await supabaseClient.auth.signOut(); 
            location.reload(); 
        };
    }

    const clientDoc = document.getElementById('client-doc');
    const docError = document.getElementById('client-doc-error');
    if (clientDoc) {
        clientDoc.oninput = (e) => {
            let val = e.target.value.replace(/\D/g, '');
            if (val.length <= 11) {
                e.target.value = val.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/g, "$1.$2.$3-$4");
            } else {
                e.target.value = val.substring(0,14).replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/g, "$1.$2.$3/$4-$5");
            }
            val = e.target.value.replace(/\D/g, '');
            
            if (val.length === 11) {
                if (!validarCPF(val)) {
                    docError.style.display = 'block';
                    docError.innerText = 'CPF inválido';
                } else {
                    docError.style.display = 'none';
                    searchClient(val);
                }
            } else if (val.length === 14) {
                if (!validarCNPJ(val)) {
                    docError.style.display = 'block';
                    docError.innerText = 'CNPJ inválido';
                } else {
                    docError.style.display = 'none';
                    searchClient(val);
                }
            } else if (val.length > 0) {
                docError.style.display = 'block';
                docError.innerText = 'Documento incompleto';
            } else {
                docError.style.display = 'none';
            }
            saveDraft();
        };
    }
    document.getElementById('add-item').onclick = () => { addItem(); saveDraft(); };
    document.getElementById('delivery-form').onsubmit = async (e) => {
        e.preventDefault();
        
        // Bloquear se CPF/CNPJ for inválido
        if (docError && docError.style.display === 'block') {
            showToast("Corrija o CPF/CNPJ inválido antes de finalizar.", "error");
            return;
        }
        
        const btn = e.target.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        
        // Inicia prefetch rápido de GPS se ainda não carregado
        if (!currentCoords && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => { currentCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude }; },
                () => {},
                { timeout: 4000 }
            );
        }
        
        openWhatsAppCheckoutModal(btn, originalText);
    };
}

async function handleAuthSuccess(user, session) {
    currentUser = user;
    document.getElementById('main-header').style.display = 'block';
    
    try {
        if (!session) {
            const { data } = await supabaseClient.auth.getSession();
            session = data.session;
        }
        const res = await fetch('/api/usuarios/me', {
            headers: { 'Authorization': `Bearer ${session?.access_token}` }
        });
        if (res.ok) {
            const dbUser = await res.json();
            if (dbUser) {
                currentUser.nome = dbUser.nome;
                currentUser.nivel_acesso = dbUser.nivel_acesso;
            }
        }
    } catch (err) {
        console.error("Erro ao carregar dados do usuário local:", err);
    }

    const displayName = currentUser.nome || user.email.split('@')[0];
    const nameEl = document.getElementById('user-display-name');
    if (nameEl) nameEl.innerText = displayName;
    
    const heroNameEl = document.getElementById('user-display-name-hero');
    if (heroNameEl) heroNameEl.innerText = displayName;
    
    const isAdmin = (currentUser.nivel_acesso === 'adm') || 
                    user.email.toLowerCase().includes('admin') || 
                    user.email.toLowerCase() === 'comercial@servweld.com.br';
                    
    const adminCard = document.getElementById('admin-card');
    if (adminCard) adminCard.style.display = isAdmin ? 'flex' : 'none';
    
    if (isAdmin) {
        checkGoogleDriveStatus();
    }
    
    // Check for Google OAuth callback parameters in hash
    const hash = window.location.hash;
    if (hash.includes('gdrive_oauth=')) {
        const urlParams = new URLSearchParams(hash.split('?')[1]);
        const status = urlParams.get('gdrive_oauth');
        const detail = urlParams.get('detail');
        
        // Remove parameters from URL hash
        window.location.hash = hash.split('?')[0];
        
        // Force view to admin-view
        localStorage.setItem('active_view', 'admin-view');
        
        setTimeout(() => {
            if (status === 'success') {
                showToast("Conta do Google vinculada e token gerado com sucesso!", "success");
                checkGoogleDriveStatus();
                loadGoogleDriveConfig();
            } else if (status === 'warning_no_refresh') {
                showToast("Conta vinculada, mas o Google não enviou o refresh token. Tente desconectar e conectar novamente.", "warning");
            } else {
                showToast("Erro na autenticação do Google: " + (detail || "desconhecido"), "error");
            }
        }, 500);
    }
    
    const savedView = localStorage.getItem('active_view');
    if (savedView && savedView !== 'login-view') {
        showView(savedView);
    } else if (localStorage.getItem('gas_draft')) {
        showView('driver-view');
    } else {
        showView('home-view');
    }
}

async function checkGoogleDriveStatus() {
    const banner = document.getElementById('gdrive-warning-banner');
    const reasonEl = document.getElementById('gdrive-warning-reason');
    if (!banner) return;
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch('/api/admin/google-drive-status', {
            headers: { 'Authorization': `Bearer ${session?.access_token}` }
        });
        if (res.ok) {
            const data = await res.json();
            if (data.status === 'success') {
                banner.style.display = 'none';
            } else {
                if (reasonEl) reasonEl.innerText = data.message || "Erro desconhecido";
                banner.style.display = 'flex';
            }
        } else {
            // Se falhar a requisição HTTP mas for adm, exibe o erro
            if (reasonEl) reasonEl.innerText = "Erro ao conectar com a API de status";
            banner.style.display = 'flex';
        }
    } catch (err) {
        console.error("Falha ao verificar status do Google Drive:", err);
    }
}

function showView(viewId) {
    const currentActiveView = document.querySelector('.view.active');
    if (currentActiveView && currentActiveView.id === 'driver-view' && viewId !== 'driver-view') {
        const hasData = document.getElementById('client-doc')?.value || 
                        document.getElementById('client-name')?.value || 
                        document.getElementById('doc-number')?.value || 
                        document.querySelectorAll('.item-card').length > 0;
                        
        if (hasData) {
            if (!confirm("Deseja realmente sair? Isso apagará as informações preenchidas nesta entrega.")) {
                return;
            }
            localStorage.removeItem('gas_draft');
            preUploadedPhotos = [];
            
            if (document.getElementById('client-doc')) document.getElementById('client-doc').value = "";
            if (document.getElementById('client-name')) document.getElementById('client-name').value = "";
            if (document.getElementById('doc-number')) document.getElementById('doc-number').value = "";
            const container = document.getElementById('items-container');
            if (container) container.innerHTML = "";
            const docError = document.getElementById('client-doc-error');
            if (docError) docError.style.display = 'none';
        }
    }

    document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.style.display = 'none'; });
    const view = document.getElementById(viewId);
    if (view) { view.classList.add('active'); view.style.display = 'block'; }
    
    localStorage.setItem('active_view', viewId);
    
    if (viewId === 'driver-view') preloadGPS();
    if (viewId === 'history-view') loadHistory();
    if (viewId === 'clients-view') loadClients();
    if (viewId === 'admin-view') {
        loadUsers();
        loadGases();
        checkWhatsAppStatus();
        loadGoogleDriveConfig();
    }
}

function getMarcasOptions(selectedMarca) {
    let marcas = JSON.parse(localStorage.getItem('gas_marcas') || '["White Martins", "IBG", "Air Liquide", "Messer"]');
    if (selectedMarca && !marcas.includes(selectedMarca)) {
        marcas.push(selectedMarca);
        localStorage.setItem('gas_marcas', JSON.stringify(marcas));
    }
    return marcas.map(m => `<option value="${m}" ${m === selectedMarca ? 'selected' : ''}>${m}</option>`).join('');
}

function handleMarcaChange(selectEl) {
    if (selectEl.value === 'NOVA_MARCA') {
        const nova = prompt('Digite o nome da nova marca:');
        if (nova && nova.trim() !== '') {
            let marcas = JSON.parse(localStorage.getItem('gas_marcas') || '["White Martins", "IBG", "Air Liquide", "Messer"]');
            if (!marcas.includes(nova.trim())) {
                marcas.push(nova.trim());
                localStorage.setItem('gas_marcas', JSON.stringify(marcas));
            }
            const currentVal = nova.trim();
            selectEl.innerHTML = '<option value="">Selecione a marca...</option>' + getMarcasOptions(currentVal) + '<option value="NOVA_MARCA">+ Adicionar Nova Marca</option>';
            selectEl.value = currentVal;
        } else {
            selectEl.value = '';
        }
    }
}

let gasesList = [];

async function loadGasesList() {
    try {
        const res = await fetch('/api/gases');
        if (res.ok) {
            gasesList = await res.json();
            localStorage.setItem('gases_list', JSON.stringify(gasesList));
        } else {
            gasesList = JSON.parse(localStorage.getItem('gases_list') || '[]');
        }
    } catch (err) {
        console.error("Erro ao carregar gases:", err);
        gasesList = JSON.parse(localStorage.getItem('gases_list') || '[]');
    }
}

function getGasesOptions(selectedVal = '') {
    const list = gasesList.length > 0 ? gasesList : [
        { nome: "Oxigênio", validade_anos: 10 },
        { nome: "Acetileno", validade_anos: 5 },
        { nome: "Argônio", validade_anos: 10 },
        { nome: "Nitrogênio", validade_anos: 10 },
        { nome: "Mistura", validade_anos: 5 },
        { nome: "CO2", validade_anos: 5 },
        { nome: "GLP", validade_anos: 15 }
    ];
    return list.map(g => `<option value="${g.nome}" ${g.nome === selectedVal ? 'selected' : ''}>${g.nome}</option>`).join('');
}

function handleGasChange(selectEl) {
    const card = selectEl.closest('.item-card');
    if (!card) return;
    const gasNome = selectEl.value;
    const gas = gasesList.find(g => g.nome === gasNome) || { validade_anos: 10 };
    const validadeAnos = gas ? gas.validade_anos : 10;
    
    const dateInput = card.querySelector('.cil-validade');
    if (dateInput) {
        const now = new Date();
        const futureYear = now.getFullYear() + validadeAnos;
        const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
        dateInput.value = `${futureYear}-${currentMonth}`;
        calcularVencimentoElement(dateInput);
    }
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
            <select class="form-control" name="tipo_gas" onchange="calcularVencimentoElement(this); handleGasChange(this); saveDraft()">
                ${getGasesOptions(data ? data.tipo_gas : '')}
            </select>
            <input type="number" class="form-control" name="qtd" value="${data?data.qtd:1}" onchange="saveDraft()">
        </div>
        <select class="form-control" name="tamanho_gas" style="margin-top:0.5rem;" onchange="saveDraft()">
            <option value="1m3">1m³</option><option value="3m3">3m³</option><option value="7m3">7m³</option>
            <option value="10m3">10m³</option><option value="1kg">1 kg</option><option value="9kg">9 kg</option>
            <option value="13kg">13 kg</option><option value="25kg">25 kg</option><option value="45kg">45 kg</option>
        </select>
        <div style="margin-top:0.5rem;">
            <label style="font-size:0.8rem; font-weight:bold; color:#666;">Marca:</label>
            <select class="form-control" name="marca" onchange="handleMarcaChange(this); saveDraft()">
                <option value="">Selecione a marca...</option>
                ${getMarcasOptions(data ? data.marca : '')}
                <option value="NOVA_MARCA">+ Adicionar Nova Marca</option>
            </select>
        </div>
        <div style="display:flex; gap:10px; margin-top:0.5rem;">
            <div style="flex:1;">
                <input type="month" class="form-control cil-validade" style="width:100%;" value="${data?data.validade:''}" oninput="calcularVencimentoElement(this)">
                <div class="cil-vencimento-msg" style="font-size:0.75rem; color:#777; margin-top:3px; line-height:1.2;"></div>
            </div>
            <input type="text" class="form-control cil-obs" placeholder="Observação..." style="flex:1;" value="${data?data.obs:''}" oninput="saveDraft()">
        </div>
        <div id="photos-${id}" style="display:grid; grid-template-columns:repeat(3,1fr); gap:5px; margin-top:5px;"></div>
        
        <div style="display:flex; gap:8px; margin-top:5px;">
            <button type="button" class="btn btn-outline" style="flex:1; font-size:0.8rem; padding:8px;" onclick="addPhoto(${id}, 'camera')">
                <i class="fas fa-camera"></i> Câmera
            </button>
            <button type="button" class="btn btn-outline" style="flex:1; font-size:0.8rem; padding:8px;" onclick="addPhoto(${id}, 'gallery')">
                <i class="fas fa-image"></i> Galeria
            </button>
        </div>
    `;
    container.appendChild(div);
    if (data) { 
        div.querySelector('[name="tipo_gas"]').value = data.tipo_gas; 
        div.querySelector('[name="tamanho_gas"]').value = data.tamanho_gas;
        if (div.querySelector('[name="marca"]') && data.marca) div.querySelector('[name="marca"]').value = data.marca;
    } else {
        const selectGas = div.querySelector('[name="tipo_gas"]');
        if (selectGas) handleGasChange(selectGas);
    }
    calcularVencimentoElement(div.querySelector('.cil-validade'));
}

function formatValidadeText(dataValidadeStr, tipoGas) {
    if (!dataValidadeStr || !dataValidadeStr.includes('-')) return { txt: '', color: '#777' };
    
    const parts = dataValidadeStr.split('-');
    const expYear = parseInt(parts[0], 10);
    const expMonth = parseInt(parts[1], 10);
    const now = new Date();
    
    let diffMonths = (expYear - now.getFullYear()) * 12 + (expMonth - 1 - now.getMonth());
    let txt = '';
    let color = '#777';
    if (diffMonths < 0) {
        diffMonths = Math.abs(diffMonths);
        let anos = Math.floor(diffMonths / 12);
        let meses = diffMonths % 12;
        txt = `Vencido há ${anos > 0 ? anos + ' ano(s) e ' : ''}${meses} mes(es) (Venceu em ${expMonth.toString().padStart(2, '0')}/${expYear})`;
        color = 'red';
    } else {
        let anos = Math.floor(diffMonths / 12);
        let meses = diffMonths % 12;
        txt = `Vence em ${anos > 0 ? anos + ' ano(s) e ' : ''}${meses} mes(es) (Vence em ${expMonth.toString().padStart(2, '0')}/${expYear})`;
    }
    return { txt, color };
}

function calcularVencimentoElement(el) {
    if (typeof saveDraft === 'function') saveDraft();
    const card = el.closest('.item-card');
    if (!card) return;
    const tipoGas = card.querySelector('[name="tipo_gas"]').value;
    const dateInput = card.querySelector('.cil-validade');
    const msgDiv = card.querySelector('.cil-vencimento-msg');
    
    if (!dateInput || !msgDiv) return;
    if (!dateInput.value) {
        msgDiv.innerHTML = '';
        return;
    }
    const res = formatValidadeText(dateInput.value, tipoGas);
    if (res.txt) {
        msgDiv.innerHTML = `<i class="fas fa-clock"></i> ` + res.txt;
        msgDiv.style.color = res.color;
    } else {
        msgDiv.innerHTML = '';
    }
}

function compressImage(file, maxWidth, maxHeight, quality) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let width = img.width;
            let height = img.height;
            
            if (width > height) {
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width = Math.round((width * maxHeight) / height);
                    height = maxHeight;
                }
            }
            
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            canvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error("Erro ao compactar imagem no Canvas"));
                }
            }, 'image/jpeg', quality);
        };
        img.onerror = (err) => reject(err);
        img.src = URL.createObjectURL(file);
    });
}

function addPhoto(id, mode = 'camera') {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (mode === 'camera') {
        input.setAttribute('capture', 'environment');
    }
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const photoId = 'photo-' + Date.now();
        const container = document.getElementById(`photos-${id}`);
        
        const photoDiv = document.createElement('div');
        photoDiv.id = photoId;
        photoDiv.className = 'photo-preview-container';
        photoDiv.style = "position: relative; width: 100%; height: 80px; border-radius: 6px; overflow: hidden; box-shadow: 0 2px 6px rgba(0,0,0,0.1);";
        
        const img = document.createElement('img');
        img.style = "width: 100%; height: 100%; object-fit: cover;";
        
        const loader = document.createElement('div');
        loader.className = 'photo-loader';
        loader.style = "position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; color: white; font-size: 0.8rem;";
        loader.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        photoDiv.appendChild(img);
        photoDiv.appendChild(loader);
        container.appendChild(photoDiv);

        // Previsualização instantânea na tela do motorista
        const reader = new FileReader();
        reader.onload = (re) => { img.src = re.target.result; };
        reader.readAsDataURL(file);

        let finalFile = file;
        try {
            // Comprime a imagem no próprio celular antes de enviar
            finalFile = await compressImage(file, 1024, 1024, 0.7);
        } catch (compressErr) {
            console.warn("[COMPRESSÃO CLIENTE] Falha ao compactar, enviando original:", compressErr);
        }

        // Se estiver offline, salva localmente em memória sem fazer requisição externa
        if (!navigator.onLine) {
            loader.remove();
            
            const localUrl = URL.createObjectURL(finalFile);
            photoDiv.setAttribute('data-url', localUrl);
            photoDiv.setAttribute('data-offline', 'true');
            
            preUploadedPhotos.push({
                id: photoId,
                isOffline: true,
                blob: finalFile,
                url: localUrl
            });
            
            // Adiciona pequeno indicador visual no preview
            const offlineIndicator = document.createElement('div');
            offlineIndicator.style = "position: absolute; bottom: 4px; left: 4px; background: rgba(230,81,0,0.95); color: white; border-radius: 4px; padding: 2px 6px; font-size: 0.6rem; font-weight: bold; z-index: 10; display: flex; align-items: center; gap: 3px;";
            offlineIndicator.innerHTML = '<i class="fas fa-wifi-slash"></i> Salvo Offline';
            photoDiv.appendChild(offlineIndicator);

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.style = "position: absolute; top: 4px; right: 4px; background: rgba(255,0,0,0.8); color: white; border: none; border-radius: 50%; width: 20px; height: 20px; font-size: 0.7rem; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 10;";
            deleteBtn.innerHTML = '&times;';
            deleteBtn.onclick = (ev) => {
                ev.stopPropagation();
                photoDiv.remove();
                preUploadedPhotos = preUploadedPhotos.filter(p => p.id !== photoId);
                saveDraft();
            };
            photoDiv.appendChild(deleteBtn);
            saveDraft();
            return;
        }

        const formData = new FormData();
        formData.append('foto', finalFile, file.name || 'foto.jpg');
        
        const clientName = document.getElementById('client-name').value || 'Cliente_Temporario';
        const docNum = document.getElementById('doc-number').value || 'S_N';
        formData.append('client_name', clientName);
        formData.append('invoice_number', docNum);

        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            const res = await fetch('/api/upload-temp-photo', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${session?.access_token}` },
                body: formData
            });
            
            if (res.ok) {
                const data = await res.json();
                loader.remove();
                
                photoDiv.setAttribute('data-url', data.drive_url);
                photoDiv.setAttribute('data-id', data.file_id);
                preUploadedPhotos.push({ id: photoId, url: data.drive_url, file_id: data.file_id });
                
                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.style = "position: absolute; top: 4px; right: 4px; background: rgba(255,0,0,0.8); color: white; border: none; border-radius: 50%; width: 20px; height: 20px; font-size: 0.7rem; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 10;";
                deleteBtn.innerHTML = '&times;';
                deleteBtn.onclick = async (ev) => {
                    ev.stopPropagation();
                    await deleteTempPhoto(photoId, data.file_id);
                };
                photoDiv.appendChild(deleteBtn);
                saveDraft();
            } else {
                const errData = await res.json().catch(() => ({}));
                const errMsg = errData.detail || "Erro desconhecido";
                showToast("Erro ao enviar foto para o Google Drive: " + errMsg, "error");
                photoDiv.remove();
            }
        } catch (err) {
            showToast("Erro de conexão no upload", "error");
            photoDiv.remove();
        }
    };
    input.click();
}

async function deleteTempPhoto(photoId, fileId) {
    const photoDiv = document.getElementById(photoId);
    if (photoDiv) photoDiv.remove();
    
    preUploadedPhotos = preUploadedPhotos.filter(p => p.id !== photoId);
    saveDraft();
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        await fetch(`/api/delete-temp-photo/${fileId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${session?.access_token}` }
        });
    } catch (e) {
        console.warn("Erro ao deletar foto do Drive:", e);
    }
}

async function submitDelivery(whatsappPhone = null, btn, originalText) {
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
    const photoUrls = preUploadedPhotos.map(p => p.url);

    const payload = {
        cnpj: document.getElementById('client-doc').value.replace(/\D/g, ''),
        nome_cliente: document.getElementById('client-name').value,
        numero_documento: document.getElementById('doc-number').value,
        data_entrega: new Date().toISOString(),
        tipo_entrega: 'motorista',
        lat: currentCoords?.lat, lng: currentCoords?.lng,
        fotos_pre_carregadas: photoUrls,
        whatsapp_phone: whatsappPhone,
        cilindros: Array.from(document.querySelectorAll('.item-card')).map(card => ({
            tipo_gas: card.querySelector('[name="tipo_gas"]').value,
            tamanho_gas: card.querySelector('[name="tamanho_gas"]').value,
            qtd: card.querySelector('[name="qtd"]').value,
            validade: card.querySelector('.cil-validade') ? card.querySelector('.cil-validade').value : '',
            obs: card.querySelector('.cil-obs').value,
            marca: card.querySelector('[name="marca"]') ? card.querySelector('[name="marca"]').value : ''
        }))
    };
    
    // Suporte para Modo Offline se estiver sem internet ou com fotos offline pendentes
    const hasOfflinePhotos = preUploadedPhotos.some(p => p.isOffline);
    if (!navigator.onLine || hasOfflinePhotos) {
        try {
            await saveDeliveryOffline(payload, preUploadedPhotos.filter(p => p.isOffline));
            showToast("Offline! Entrega salva no celular com sucesso.", "success");
            localStorage.removeItem('gas_draft');
            preUploadedPhotos = [];
            
            const modal = document.getElementById('whatsapp-checkout-modal');
            if (modal) modal.style.display = 'none';
            setTimeout(() => { location.reload(); }, 1500);
        } catch (saveErr) {
            console.error("Erro ao salvar offline:", saveErr);
            showToast("Erro ao registrar entrega offline", "error");
            btn.disabled = false; btn.innerHTML = originalText;
        }
        return;
    }
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch('/api/entregas', { 
            method: 'POST', 
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session?.access_token}` 
            }, 
            body: JSON.stringify(payload)
        });
        if (res.ok) { 
            showToast("Entrega registrada com sucesso!"); 
            localStorage.removeItem('gas_draft'); 
            preUploadedPhotos = [];
            
            // Fecha o modal se estiver aberto e recarrega
            const modal = document.getElementById('whatsapp-checkout-modal');
            if (modal) modal.style.display = 'none';
            setTimeout(() => { location.reload(); }, 1000);
        }
        else { showToast("Erro no envio", "error"); btn.disabled = false; btn.innerHTML = originalText; }
    } catch (err) { showToast("Erro conexão", "error"); btn.disabled = false; btn.innerHTML = originalText; }
}

function openWhatsAppCheckoutModal(btn, originalText) {
    const modal = document.getElementById('whatsapp-checkout-modal');
    const phoneInput = document.getElementById('whatsapp-phone-input');
    const cancelBtn = document.getElementById('whatsapp-cancel-btn');
    const sendBtn = document.getElementById('whatsapp-send-btn');
    const cnpjVal = document.getElementById('client-doc').value.replace(/\D/g, '');
    
    if (!modal) {
        submitDelivery(null, btn, originalText);
        return;
    }
    
    if (phoneInput) {
        phoneInput.oninput = (e) => {
            let val = e.target.value.replace(/\D/g, '');
            if (val.length <= 11) {
                e.target.value = val.replace(/^(\d{2})(\d)/g,"($1) $2").replace(/(\d)(\d{4})$/,"$1-$2");
            } else {
                e.target.value = val.substring(0, 11).replace(/^(\d{2})(\d)/g,"($1) $2").replace(/(\d)(\d{4})$/,"$1-$2");
            }
        };
        
        const storedPhone = localStorage.getItem(`phone_${cnpjVal}`) || "";
        phoneInput.value = storedPhone;
        if (storedPhone) {
            let val = storedPhone.replace(/\D/g, '');
            phoneInput.value = val.replace(/^(\d{2})(\d)/g,"($1) $2").replace(/(\d)(\d{4})$/,"$1-$2");
        }
    }
    
    cancelBtn.onclick = () => {
        modal.style.display = 'none';
        submitDelivery(null, btn, originalText);
    };
    
    sendBtn.onclick = () => {
        const rawPhone = phoneInput.value.replace(/\D/g, '');
        if (rawPhone.length < 10) {
            showToast("Digite um número de WhatsApp válido com DDD.", "error");
            return;
        }
        
        localStorage.setItem(`phone_${cnpjVal}`, rawPhone);
        modal.style.display = 'none';
        submitDelivery(rawPhone, btn, originalText);
    };
    
    modal.style.display = 'flex';
}

async function checkWhatsAppStatus() {
    const container = document.getElementById('whatsapp-status-container');
    if (!container) return;
    
    container.innerHTML = '<p style="color: #666; font-weight: 500;"><i class="fas fa-spinner fa-spin"></i> Verificando status da Evolution API...</p>';
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch('/api/whatsapp/status', {
            headers: { 'Authorization': `Bearer ${session?.access_token}` }
        });
        if (res.ok) {
            const data = await res.json();
            if (data.status === 'success' && data.state === 'open') {
                container.innerHTML = `
                    <div style="color: #25D366; font-weight: 700; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 1rem;">
                        <i class="fas fa-check-circle" style="font-size: 1.4rem;"></i> CONECTADO E PRONTO
                    </div>
                    <p style="font-size: 0.8rem; color: #666; margin-bottom: 1rem;">O sistema de disparo automático está ativo.</p>
                    <button onclick="disconnectWhatsApp()" class="btn btn-outline" style="border-color: #dc3545; color: #dc3545; font-size: 0.85rem; padding: 0.5rem 1rem; width: auto; font-weight: 600;">
                        <i class="fas fa-unlink"></i> Desconectar WhatsApp
                    </button>
                `;
            } else {
                container.innerHTML = `
                    <div style="color: #dc3545; font-weight: 700; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 1rem;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 1.4rem;"></i> WHATSAPP DESCONECTADO
                    </div>
                    <p style="font-size: 0.8rem; color: #666; margin-bottom: 1.25rem;">Gere um QR Code para escanear com o seu aparelho corporativo.</p>
                    <button onclick="generateWhatsAppQR()" class="btn btn-primary" style="background: #25D366; border-color: #25D366; font-size: 0.85rem; padding: 0.6rem 1.2rem; width: auto; font-weight: 600;">
                        <i class="fab fa-whatsapp"></i> Gerar QR Code de Conexão
                    </button>
                    <div id="whatsapp-qr-wrapper" style="margin-top: 1.5rem; display: none; text-align: center;">
                        <div id="whatsapp-qr-spinner" style="color: #666; font-weight: 500; font-size: 0.85rem;"><i class="fas fa-spinner fa-spin"></i> Solicitando QR Code...</div>
                        <img id="whatsapp-qr-img" style="max-width: 250px; height: auto; border: 4px solid #fff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: none; margin: 0 auto;" alt="QR Code WhatsApp">
                        <p style="font-size: 0.75rem; color: #999; margin-top: 8px;">Aponte o WhatsApp em Aparelhos Conectados ➡️ Conectar um Aparelho.</p>
                    </div>
                `;
            }
        } else {
            container.innerHTML = `<p style="color: #dc3545; font-weight: 600;"><i class="fas fa-exclamation-circle"></i> Erro ao consultar a API: ${res.statusText}</p>`;
        }
    } catch (err) {
        container.innerHTML = `<p style="color: #dc3545; font-weight: 600;"><i class="fas fa-exclamation-circle"></i> Falha de conexão: ${err.message}</p>`;
    }
}

async function generateWhatsAppQR() {
    const wrapper = document.getElementById('whatsapp-qr-wrapper');
    const img = document.getElementById('whatsapp-qr-img');
    const spinner = document.getElementById('whatsapp-qr-spinner');
    
    if (!wrapper) return;
    wrapper.style.display = 'block';
    if (img) img.style.display = 'none';
    if (spinner) spinner.style.display = 'block';
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch('/api/whatsapp/qr', {
            headers: { 'Authorization': `Bearer ${session?.access_token}` }
        });
        if (res.ok) {
            const data = await res.json();
            if (data.status === 'success' && data.base64) {
                spinner.style.display = 'none';
                img.src = data.base64;
                img.style.display = 'block';
                
                // Monitora a conexão periodicamente
                setTimeout(checkWhatsAppStatus, 5000);
            } else {
                spinner.innerHTML = `<span style="color: #dc3545;"><i class="fas fa-exclamation-circle"></i> ${data.message || 'Erro ao gerar QR Code'}</span>`;
            }
        } else {
            spinner.innerHTML = `<span style="color: #dc3545;"><i class="fas fa-exclamation-circle"></i> Erro: ${res.statusText}</span>`;
        }
    } catch (err) {
        spinner.innerHTML = `<span style="color: #dc3545;"><i class="fas fa-exclamation-circle"></i> Falha: ${err.message}</span>`;
    }
}

async function disconnectWhatsApp() {
    if (!confirm("Deseja realmente desconectar o WhatsApp do sistema? Isso desativará os envios automáticos.")) return;
    
    const container = document.getElementById('whatsapp-status-container');
    if (container) container.innerHTML = '<p style="color: #666; font-weight: 500;"><i class="fas fa-spinner fa-spin"></i> Desconectando...</p>';
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch('/api/whatsapp/disconnect', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session?.access_token}` }
        });
        showToast("Instância desconectada com sucesso!");
        setTimeout(checkWhatsAppStatus, 1500);
    } catch (err) {
        showToast("Erro ao desconectar: " + err.message, "error");
        checkWhatsAppStatus();
    }
}

function toggleGoogleDriveAuthFields() {
    const useSA = document.getElementById('gdrive-use-service-account').checked;
    const oauthFields = document.getElementById('gdrive-oauth-fields');
    const saInfo = document.getElementById('gdrive-service-account-info');
    
    if (useSA) {
        oauthFields.style.display = 'none';
        saInfo.style.display = 'block';
        document.getElementById('gdrive-client-id').removeAttribute('required');
        document.getElementById('gdrive-client-secret').removeAttribute('required');
        document.getElementById('gdrive-refresh-token').removeAttribute('required');
    } else {
        oauthFields.style.display = 'block';
        saInfo.style.display = 'none';
        document.getElementById('gdrive-client-id').setAttribute('required', 'true');
        document.getElementById('gdrive-client-secret').setAttribute('required', 'true');
        document.getElementById('gdrive-refresh-token').setAttribute('required', 'true');
    }
}

async function loadGoogleDriveConfig() {
    const statusMsg = document.getElementById('gdrive-status-message');
    if (statusMsg) statusMsg.style.display = 'none';
    
    const redirectUriDisplay = document.getElementById('gdrive-redirect-uri-display');
    if (redirectUriDisplay) {
        redirectUriDisplay.innerText = window.location.origin + '/api/admin/google-drive/callback';
    }
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch('/api/admin/google-drive-config', {
            headers: { 'Authorization': `Bearer ${session?.access_token}` }
        });
        if (res.ok) {
            const data = await res.json();
            document.getElementById('gdrive-use-service-account').checked = !!data.USE_SERVICE_ACCOUNT;
            document.getElementById('gdrive-client-id').value = data.GOOGLE_CLIENT_ID || '';
            document.getElementById('gdrive-client-secret').value = data.GOOGLE_CLIENT_SECRET || '';
            document.getElementById('gdrive-refresh-token').value = data.GOOGLE_REFRESH_TOKEN || '';
            document.getElementById('gdrive-root-folder-id').value = data.DRIVE_ROOT_FOLDER_ID || '';
            document.getElementById('gdrive-redirect-uri').value = data.GOOGLE_REDIRECT_URI || '';
            
            const saEmailDisplay = document.getElementById('gdrive-service-account-email-display');
            if (saEmailDisplay) {
                if (data.SERVICE_ACCOUNT_EMAIL) {
                    saEmailDisplay.innerText = data.SERVICE_ACCOUNT_EMAIL;
                    saEmailDisplay.style.color = '#0d47a1';
                } else {
                    saEmailDisplay.innerText = 'Arquivo service-account.json NÃO encontrado no servidor!';
                    saEmailDisplay.style.color = '#c62828';
                }
            }
            toggleGoogleDriveAuthFields();
        } else {
            console.error("Erro ao carregar configurações do Google Drive");
        }
    } catch (err) {
        console.error("Falha ao carregar configurações do Google Drive:", err);
    }
}

async function saveGoogleDriveConfig(e) {
    if (e) e.preventDefault();
    
    const saveBtn = document.getElementById('gdrive-save-btn');
    const originalText = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
    
    const payload = {
        USE_SERVICE_ACCOUNT: document.getElementById('gdrive-use-service-account').checked,
        GOOGLE_CLIENT_ID: document.getElementById('gdrive-client-id').value.trim(),
        GOOGLE_CLIENT_SECRET: document.getElementById('gdrive-client-secret').value.trim(),
        GOOGLE_REFRESH_TOKEN: document.getElementById('gdrive-refresh-token').value.trim(),
        DRIVE_ROOT_FOLDER_ID: document.getElementById('gdrive-root-folder-id').value.trim(),
        GOOGLE_REDIRECT_URI: document.getElementById('gdrive-redirect-uri').value.trim().replace(/\/$/, '')
    };
    
    const statusMsg = document.getElementById('gdrive-status-message');
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch('/api/admin/google-drive-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session?.access_token}`
            },
            body: JSON.stringify(payload)
        });
        
        if (res.ok) {
            const data = await res.json();
            showToast(data.message || "Configurações salvas com sucesso!");
            if (statusMsg) {
                statusMsg.style.display = 'block';
                statusMsg.style.background = '#e8f5e9';
                statusMsg.style.color = '#2e7d32';
                statusMsg.innerHTML = '<i class="fas fa-check-circle"></i> Configurações salvas com sucesso!';
            }
            // Reload config to update service account status / email dynamically
            setTimeout(loadGoogleDriveConfig, 500);
        } else {
            const errData = await res.json().catch(() => ({}));
            showToast(errData.detail || "Erro ao salvar configurações", "error");
        }
    } catch (err) {
        showToast("Falha de conexão: " + err.message, "error");
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalText;
    }
}

async function testGoogleDriveConfig() {
    const testBtn = document.getElementById('gdrive-test-btn');
    const originalText = testBtn.innerHTML;
    testBtn.disabled = true;
    testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testando...';
    
    const payload = {
        USE_SERVICE_ACCOUNT: document.getElementById('gdrive-use-service-account').checked,
        GOOGLE_CLIENT_ID: document.getElementById('gdrive-client-id').value.trim(),
        GOOGLE_CLIENT_SECRET: document.getElementById('gdrive-client-secret').value.trim(),
        GOOGLE_REFRESH_TOKEN: document.getElementById('gdrive-refresh-token').value.trim(),
        DRIVE_ROOT_FOLDER_ID: document.getElementById('gdrive-root-folder-id').value.trim(),
        GOOGLE_REDIRECT_URI: document.getElementById('gdrive-redirect-uri').value.trim().replace(/\/$/, '')
    };
    
    const statusMsg = document.getElementById('gdrive-status-message');
    if (statusMsg) {
        statusMsg.style.display = 'block';
        statusMsg.style.background = '#e3f2fd';
        statusMsg.style.color = '#1565c0';
        statusMsg.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Estabelecendo conexão com o Google Drive...';
    }
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch('/api/admin/google-drive-config/test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session?.access_token}`
            },
            body: JSON.stringify(payload)
        });
        
        if (res.ok) {
            const data = await res.json();
            if (data.status === 'success') {
                showToast("Conexão bem sucedida!");
                if (statusMsg) {
                    statusMsg.style.background = '#e8f5e9';
                    statusMsg.style.color = '#2e7d32';
                    statusMsg.innerHTML = '<i class="fas fa-check-circle"></i> ' + data.message;
                }
            } else {
                showToast(data.message, "error");
                if (statusMsg) {
                    statusMsg.style.background = '#ffebee';
                    statusMsg.style.color = '#c62828';
                    statusMsg.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ' + data.message;
                }
            }
        } else {
            showToast("Erro ao processar o teste", "error");
        }
    } catch (err) {
        showToast("Falha de conexão: " + err.message, "error");
        if (statusMsg) {
            statusMsg.style.background = '#ffebee';
            statusMsg.style.color = '#c62828';
            statusMsg.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Falha de conexão: ' + err.message;
        }
    } finally {
        testBtn.disabled = false;
        testBtn.innerHTML = originalText;
    }
}

async function loginGoogleDriveOAuth() {
    const oauthBtn = document.getElementById('gdrive-oauth-btn');
    const originalText = oauthBtn.innerHTML;
    
    // First, save configuration to ensure current Client ID/Secret are used
    await saveGoogleDriveConfig();
    
    oauthBtn.disabled = true;
    oauthBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Redirecionando...';
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch('/api/admin/google-drive/auth-url', {
            headers: { 'Authorization': `Bearer ${session?.access_token}` }
        });
        
        if (res.ok) {
            const data = await res.json();
            if (data.url) {
                window.location.href = data.url;
            } else {
                showToast("Erro ao gerar URL de autorização", "error");
                oauthBtn.disabled = false;
                oauthBtn.innerHTML = originalText;
            }
        } else {
            const errData = await res.json().catch(() => ({}));
            showToast("Erro: " + (errData.detail || "Não foi possível iniciar o login"), "error");
            oauthBtn.disabled = false;
            oauthBtn.innerHTML = originalText;
        }
    } catch (err) {
        showToast("Falha de conexão: " + err.message, "error");
        oauthBtn.disabled = false;
        oauthBtn.innerHTML = originalText;
    }
}

async function searchClient(doc) {
    try {
        const res = await fetch(`/api/cnpj/${doc}`);
        if (res.ok) { const data = await res.json(); document.getElementById('client-name').value = data.nome_razao || ""; saveDraft(); }
    } catch (err) {}
}

async function deleteDelivery(id) {
    if (!confirm("Tem certeza que deseja excluir esta entrega do histórico? Esta ação não pode ser desfeita.")) return;
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch(`/api/deletar_entrega/${id}`, {
            headers: { 'Authorization': `Bearer ${session?.access_token}` }
        });
        if (res.ok) {
            showToast("Entrega excluída!");
            loadHistory();
        } else {
            const err = await res.json();
            showToast("Erro ao excluir: " + (err.detail || "Tente novamente"), "error");
        }
    } catch (e) { showToast("Erro de conexão", "error"); }
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
                    <div style="display:flex; align-items:center; gap:12px;">
                        ${currentUser && (currentUser.nivel_acesso === 'adm' || (currentUser.email && (currentUser.email.toLowerCase().includes('admin') || currentUser.email.toLowerCase() === 'comercial@servweld.com.br'))) ? `
                            <button type="button" onclick="event.stopPropagation(); deleteDelivery(${item.id})" style="color:var(--danger, #f44336); border:none; background:none; font-size:1.15rem; cursor:pointer; display:inline-flex;" title="Excluir entrega">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        ` : ''}
                        <i class="fas fa-chevron-down" id="icon-${item.id}" style="color:#ccc;"></i>
                    </div>
                </div>
                <div id="details-${item.id}" style="display:none; margin-top:12px; padding-top:12px; border-top:1px solid #eee;">
                    <p style="font-size:0.85rem; font-weight:600; color:var(--primary); margin-bottom:8px;">Itens da Entrega:</p>
                    ${(item.itens || []).map(i => {
                        let validadeHtml = '';
                        if (i.validade && i.validade !== '-') {
                            const vStr = i.validade.includes('-') ? i.validade.split('-').reverse().slice(0, 2).join('/') : i.validade;
                            const res = formatValidadeText(i.validade, i.gas);
                            validadeHtml = `<div style="color:${res.color || '#777'}; font-size:0.75rem; margin-top:3px;"><i class="fas fa-calendar-alt"></i> Validade Base: ${vStr} - <b>${res.txt || ''}</b></div>`;
                        }
                        return `
                        <div style="font-size:0.8rem; background:#f9f9f9; padding:8px; border-radius:6px; margin-bottom:6px; border:1px solid #eee;">
                            <b>${i.qtd || 1}x ${i.gas || 'Gás'} (${i.tam || 'Tam n/a'})</b> ${i.marca ? `<span style="color:#2e7d32; font-weight:600;">[${i.marca}]</span>` : ''}
                            ${validadeHtml}
                            ${i.obs ? `<div style="color:#777; font-size:0.75rem; margin-top:3px; font-style:italic;">Obs: ${i.obs}</div>` : ''}
                        </div>
                    `}).join('') || '<p style="font-size:0.8rem; color:#999;">Sem detalhes de itens.</p>'}
                    
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
                    <div style="margin-top:16px; border-top:1px dashed #eee; padding-top:12px; display:flex; justify-content:flex-end;">
                        <button type="button" onclick="event.stopPropagation(); resendWhatsApp(${item.id}, '${(item.cliente || "Cliente").replace(/'/g, "\\'")}')" class="btn btn-outline" style="font-size:0.8rem; padding:6px 14px; border-color:#25D366; color:#25D366; background:#f0fff4; width:auto; display:inline-flex; align-items:center; gap:8px;">
                            <i class="fab fa-whatsapp" style="font-size:1rem;"></i> Reenviar p/ WhatsApp
                        </button>
                    </div>
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

async function deleteClient(cnpj) {
    if (!confirm("Tem certeza que deseja excluir este cliente completamente do sistema?")) return;
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch(`/api/clientes/${cnpj}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${session?.access_token}` }
        });
        if (res.ok) {
            showToast("Cliente excluído!");
            loadClients();
        } else {
            showToast("Erro ao excluir cliente", "error");
        }
    } catch (e) { showToast("Erro de conexão", "error"); }
}

function renderClientsList(clients) {
    const container = document.getElementById('clients-list-container');
    if (!container) return;
    
    container.style.display = 'grid';
    container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(300px, 1fr))';
    container.style.gap = '16px';
    container.style.padding = '8px 0';

    const isAdmin = isAdminUser();

    container.innerHTML = clients.map(c => {
        const hasLocation = c.lat !== null && c.lat !== undefined && c.lat !== "";
        
        return `
        <div class="list-item" style="padding: 16px; background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.06); border-top: 4px solid var(--primary); display: flex; flex-direction: column; justify-content: space-between; min-height: 220px; transition: transform 0.2s, box-shadow 0.2s; position: relative; margin-bottom: 0;">
            <div>
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                    <h4 style="margin: 0 0 6px 0; font-size: 0.95rem; color: var(--dark); line-height: 1.3; font-weight: 700; word-break: break-word; flex: 1;">${c.nome_razao || "Sem Nome"}</h4>
                    ${isAdmin ? `
                        <div style="display: flex; gap: 4px;">
                            ${hasLocation ? `
                                <button onclick="registerClientLocation('${c.cnpj}')" class="btn btn-outline" style="border: none; color: #ff9800; padding: 4px 6px; width: auto; font-size: 0.9rem; background: transparent; cursor: pointer; display: inline-flex;" title="Ajustar Pin da Localização">
                                    <i class="fas fa-map-marker-alt"></i>
                                </button>
                            ` : ''}
                            <button onclick="deleteClient('${c.cnpj}')" class="btn btn-outline" style="border: none; color: var(--danger); padding: 4px 6px; width: auto; font-size: 0.9rem; background: transparent; cursor: pointer; display: inline-flex;" title="Excluir Cliente do Sistema">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    ` : ''}
                </div>
                <p style="font-size: 0.8rem; color: #777; margin: 0 0 12px 0; display: flex; align-items: center; gap: 5px;">
                    <i class="fas fa-id-card" style="color: #bbb;"></i> ${c.cnpj || "Sem CNPJ"}
                </p>
            </div>
            
            <div style="margin-top: auto;">
                ${hasLocation ? `
                    <div style="border-radius: 8px; overflow: hidden; border: 1px solid #eee; position: relative; height: 120px; margin-bottom: 8px;">
                        <iframe 
                            width="100%" 
                            height="120" 
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
                    <button type="button" onclick="registerClientLocation('${c.cnpj}')" class="btn btn-outline" style="font-size: 0.7rem; padding: 6px 10px; width: 100%; border-color: #ff9800; color: #ff9800; display: flex; align-items: center; justify-content: center; gap: 6px; background: #fff; border-radius: 8px; font-weight: 600;">
                        <i class="fas fa-edit"></i> Ajustar Pin
                    </button>
                ` : `
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <p style="font-size: 0.75rem; color: #999; margin: 4px 0; font-style: italic; display: flex; align-items: center; gap: 5px;">
                            <i class="fas fa-map-marker-alt" style="color: var(--danger);"></i> Sem localização registrada
                        </p>
                        <button type="button" onclick="registerClientLocation('${c.cnpj}')" class="btn btn-outline" style="font-size: 0.75rem; padding: 8px 12px; width: 100%; border-color: var(--primary); color: var(--primary); display: flex; align-items: center; justify-content: center; gap: 6px; background: #fff; border-radius: 8px; font-weight: 600;">
                            <i class="fas fa-map-pin"></i> Registrar Localização
                        </button>
                    </div>
                `}
            </div>
        </div>
        `;
    }).join('') || '<p style="text-align:center; padding:2rem; color:#999; grid-column: 1 / -1;">Nenhum cliente cadastrado.</p>';
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
        preUploadedPhotos: preUploadedPhotos,
        items: Array.from(document.querySelectorAll('.item-card')).map(card => {
            const labelText = card.querySelector('b')?.innerText || "";
            const id = labelText.replace(/\D/g, '') || "1";
            const photos = Array.from(card.querySelectorAll('.photo-preview-container')).map(p => ({
                id: p.id,
                url: p.getAttribute('data-url'),
                file_id: p.getAttribute('data-id')
            }));
            return {
                id: id,
                tipo_gas: card.querySelector('[name="tipo_gas"]').value,
                tamanho_gas: card.querySelector('[name="tamanho_gas"]').value,
                qtd: card.querySelector('[name="qtd"]').value,
                obs: card.querySelector('.cil-obs').value,
                photos: photos
            };
        })
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
            
            if (data.preUploadedPhotos) {
                preUploadedPhotos = data.preUploadedPhotos;
            }
            
            if (data.items) {
                data.items.forEach(item => {
                    addItem(item);
                    if (item.photos) {
                        const container = document.getElementById(`photos-${item.id}`);
                        if (container) {
                            item.photos.forEach(p => {
                                const photoDiv = document.createElement('div');
                                photoDiv.id = p.id;
                                photoDiv.className = 'photo-preview-container';
                                photoDiv.style = "position: relative; width: 100%; height: 80px; border-radius: 6px; overflow: hidden; box-shadow: 0 2px 6px rgba(0,0,0,0.1);";
                                photoDiv.setAttribute('data-url', p.url);
                                photoDiv.setAttribute('data-id', p.file_id);
                                
                                const img = document.createElement('img');
                                img.style = "width: 100%; height: 100%; object-fit: cover;";
                                img.src = getDisplayUrl(p.url);
                                
                                const deleteBtn = document.createElement('button');
                                deleteBtn.type = 'button';
                                deleteBtn.style = "position: absolute; top: 4px; right: 4px; background: rgba(255,0,0,0.8); color: white; border: none; border-radius: 50%; width: 20px; height: 20px; font-size: 0.7rem; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 10;";
                                deleteBtn.innerHTML = '&times;';
                                deleteBtn.onclick = async (ev) => {
                                    ev.stopPropagation();
                                    await deleteTempPhoto(p.id, p.file_id);
                                };
                                
                                photoDiv.appendChild(img);
                                photoDiv.appendChild(deleteBtn);
                                container.appendChild(photoDiv);
                            });
                        }
                    }
                });
            }
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
        let formattedUrl = driveUrl.replace('export=download', 'export=view');
        
        let fileId = "";
        
        if (formattedUrl.includes('/file/d/')) {
            const parts = formattedUrl.split('/file/d/');
            if (parts.length > 1) {
                fileId = parts[1].split('/')[0].split('?')[0];
            }
        }
        
        if (!fileId) {
            const urlObj = new URL(formattedUrl);
            fileId = urlObj.searchParams.get("id");
        }
        
        if (fileId) {
            return `/api/proxy-image/${fileId}`;
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

let locationPickerMap = null;
let locationPickerMarker = null;
let currentPickerCnpj = null;
let pickerSelectedCoords = null;

function registerClientLocation(cnpj) {
    currentPickerCnpj = cnpj;
    
    // Tenta carregar coordenadas pré-existentes do cliente se já houver
    const client = allClients.find(c => c.cnpj === cnpj);
    let initialLat = -22.9068; // Rio de Janeiro / Brasil como fallback padrão
    let initialLng = -43.1729;
    let zoom = 4;
    
    if (client && client.lat && client.lng) {
        initialLat = parseFloat(client.lat);
        initialLng = parseFloat(client.lng);
        zoom = 15;
    }
    
    openLocationPickerModal(initialLat, initialLng, zoom);
}

function openLocationPickerModal(lat, lng, zoom = 15) {
    const modal = document.getElementById('location-picker-modal');
    const coordsSpan = document.getElementById('location-picker-coords');
    const saveBtn = document.getElementById('save-location-btn');
    
    if (!modal) return;
    
    modal.style.display = 'flex';
    pickerSelectedCoords = { lat, lng };
    
    if (coordsSpan) {
        coordsSpan.innerText = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
    if (saveBtn) {
        saveBtn.disabled = false;
    }
    
    // Sempre destrói e recria o mapa para evitar o bug do mapa cinza
    // (o Leaflet perde as dimensões do container quando o modal some e reaparece)
    if (locationPickerMap) {
        locationPickerMap.remove();
        locationPickerMap = null;
        locationPickerMarker = null;
    }

    // Aguarda o modal estar visível antes de inicializar o Leaflet
    setTimeout(() => {
        const mapContainer = document.getElementById('location-picker-map');
        if (!mapContainer) return;

        locationPickerMap = L.map(mapContainer, { zoomControl: true }).setView([lat, lng], zoom);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap'
        }).addTo(locationPickerMap);
        
        // Marcador vetorial em CSS Puro para evitar falhas de rede CORS com imagens externas
        const cssIcon = L.divIcon({
            className: 'custom-div-pin',
            html: `<div style="
                background-color: #28a745;
                width: 24px;
                height: 24px;
                border-radius: 50% 50% 50% 0;
                position: absolute;
                transform: rotate(-45deg);
                left: -12px;
                top: -24px;
                border: 2px solid white;
                box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            "></div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 24]
        });
        
        locationPickerMarker = L.marker([lat, lng], {
            draggable: true,
            icon: cssIcon
        }).addTo(locationPickerMap);
        
        // Evento ao arrastar o marcador
        locationPickerMarker.on('dragend', function () {
            const position = locationPickerMarker.getLatLng();
            updateSelectedCoords(position.lat, position.lng);
        });
        
        // Evento ao clicar no mapa
        locationPickerMap.on('click', function (e) {
            const { lat, lng } = e.latlng;
            locationPickerMarker.setLatLng([lat, lng]);
            updateSelectedCoords(lat, lng);
        });

        // Força múltiplos recálculos de layout em tempos variados para remover a tela cinza
        locationPickerMap.whenReady(() => {
            locationPickerMap.invalidateSize();
        });
        locationPickerMap.invalidateSize();
        setTimeout(() => { if (locationPickerMap) locationPickerMap.invalidateSize(); }, 50);
        setTimeout(() => { if (locationPickerMap) locationPickerMap.invalidateSize(); }, 200);
        setTimeout(() => { if (locationPickerMap) locationPickerMap.invalidateSize(); }, 500);
    }, 100);
}

function updateSelectedCoords(lat, lng) {
    pickerSelectedCoords = { lat, lng };
    const coordsSpan = document.getElementById('location-picker-coords');
    if (coordsSpan) {
        coordsSpan.innerText = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
    const saveBtn = document.getElementById('save-location-btn');
    if (saveBtn) {
        saveBtn.disabled = false;
    }
}

function recenterToGPS() {
    if (!navigator.geolocation) {
        showToast("Seu dispositivo não suporta Geolocalização.", "error");
        return;
    }
    
    const gpsBtn = document.getElementById('recenter-gps-btn');
    let originalHtml = "";
    if (gpsBtn) {
        originalHtml = gpsBtn.innerHTML;
        gpsBtn.disabled = true;
        gpsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> GPS...';
    }
    
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            
            if (locationPickerMap && locationPickerMarker) {
                locationPickerMap.setView([lat, lng], 16);
                locationPickerMarker.setLatLng([lat, lng]);
                updateSelectedCoords(lat, lng);
            }
            if (gpsBtn) {
                gpsBtn.disabled = false;
                gpsBtn.innerHTML = originalHtml;
            }
            showToast("Localização GPS obtida!");
        },
        (err) => {
            showToast("Erro ao obter GPS. Certifique-se de que a localização está ativada.", "error");
            if (gpsBtn) {
                gpsBtn.disabled = false;
                gpsBtn.innerHTML = originalHtml;
            }
        },
        { timeout: 7000, enableHighAccuracy: true }
    );
}

async function saveManualLocation() {
    if (!currentPickerCnpj || !pickerSelectedCoords) {
        showToast("Selecione um local no mapa antes de salvar.", "error");
        return;
    }
    
    const saveBtn = document.getElementById('save-location-btn');
    let originalHtml = "";
    if (saveBtn) {
        originalHtml = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
    }
    
    const { lat, lng } = pickerSelectedCoords;
    const cnpj = currentPickerCnpj;
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch('/api/clientes/localizacao', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session?.access_token}`
            },
            body: JSON.stringify({ cnpj, lat, lng })
        });
        
        if (res.ok) {
            showToast("Localização salva com sucesso!");
            closeLocationPickerModal();
            loadClients(); // Atualiza a lista
        } else {
            const errData = await res.json();
            showToast("Erro ao salvar: " + (errData.detail || "Tente novamente"), "error");
        }
    } catch (err) {
        showToast("Erro de conexão.", "error");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalHtml;
        }
    }
}

function closeLocationPickerModal() {
    const modal = document.getElementById('location-picker-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    // Destrói o mapa para forçar recriação limpa na próxima abertura
    if (locationPickerMap) {
        locationPickerMap.remove();
        locationPickerMap = null;
        locationPickerMarker = null;
    }
    currentPickerCnpj = null;
    pickerSelectedCoords = null;
}

async function deleteClientLocation(cnpj) {
    if (!confirm("Tem certeza que deseja excluir a localização registrada deste cliente?")) {
        return;
    }
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch('/api/clientes/localizacao', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session?.access_token}`
            },
            body: JSON.stringify({ cnpj, lat: null, lng: null })
        });
        
        if (res.ok) {
            showToast("Localização excluída com sucesso!");
            loadClients(); // Atualiza a lista
        } else {
            showToast("Erro ao excluir. Tente novamente.", "error");
        }
    } catch (err) {
        showToast("Erro de conexão.", "error");
    }
}

function isAdminUser() {
    if (!currentUser) return false;
    if (currentUser.nivel_acesso === 'adm') return true;
    const email = (currentUser.email || "").toLowerCase();
    return email.includes('admin') || email === 'comercial@servweld.com.br';
}

let allUsers = [];

async function loadUsers() {
    const container = document.getElementById('user-list-container');
    if (!container) return;
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch('/api/admin/usuarios', {
            headers: { 'Authorization': `Bearer ${session?.access_token}` }
        });
        
        if (res.ok) {
            allUsers = await res.json();
            renderUsersList(allUsers);
        } else {
            container.innerHTML = `<p style="text-align: center; color: var(--danger); padding: 2rem;">Acesso negado ou erro ao carregar usuários.</p>`;
        }
    } catch (err) {
        container.innerHTML = `<p style="text-align: center; color: var(--danger); padding: 2rem;">Erro ao conectar ao servidor.</p>`;
    }
}

function renderUsersList(users) {
    const container = document.getElementById('user-list-container');
    if (!container) return;
    
    // Grid Layout responsivo para usuários
    container.style.display = 'grid';
    container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
    container.style.gap = '16px';
    
    container.innerHTML = users.map(u => {
        const isAdmUser = u.nivel_acesso === 'adm';
        const roleBadge = isAdmUser 
            ? `<span style="background: #fce4ec; color: #c2185b; padding: 4px 8px; border-radius: 12px; font-size: 0.7rem; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;"><i class="fas fa-user-shield"></i> Administrador</span>`
            : `<span style="background: #e3f2fd; color: #1976d2; padding: 4px 8px; border-radius: 12px; font-size: 0.7rem; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;"><i class="fas fa-truck"></i> Motorista</span>`;
            
        return `
        <div class="list-item" style="padding: 16px; background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.06); border-top: 4px solid ${isAdmUser ? '#c2185b' : 'var(--primary)'}; display: flex; flex-direction: column; justify-content: space-between; min-height: 140px; margin-bottom: 0;">
            <div>
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 6px;">
                    <h4 style="margin: 0; font-size: 0.95rem; color: var(--dark); font-weight: 700; line-height: 1.3; word-break: break-word;">${u.nome}</h4>
                    <div style="display: flex; gap: 4px;">
                        <button onclick="openUserModal(${u.id})" class="btn btn-outline" style="border: none; color: var(--primary); padding: 4px 6px; width: auto; font-size: 0.85rem; background: transparent; cursor: pointer;" title="Editar Usuário">
                            <i class="fas fa-pencil-alt"></i>
                        </button>
                        <button onclick="deleteUser(${u.id})" class="btn btn-outline" style="border: none; color: var(--danger); padding: 4px 6px; width: auto; font-size: 0.85rem; background: transparent; cursor: pointer;" title="Excluir Usuário">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </div>
                <p style="font-size: 0.8rem; color: #666; margin: 0 0 12px 0; display: flex; align-items: center; gap: 6px; word-break: break-word;">
                    <i class="fas fa-envelope" style="color: #bbb;"></i> ${u.usuario}
                </p>
            </div>
            <div style="margin-top: auto;">
                ${roleBadge}
            </div>
        </div>
        `;
    }).join('') || `<p style="text-align: center; color: #999; padding: 2rem; grid-column: 1 / -1;">Nenhum usuário cadastrado.</p>`;
}

function openUserModal(userId = null) {
    const modal = document.getElementById('user-modal');
    const form = document.getElementById('user-form');
    const title = document.getElementById('user-modal-title');
    const idField = document.getElementById('user-id-field');
    const nomeField = document.getElementById('user-nome-field');
    const emailField = document.getElementById('user-email-field');
    const senhaField = document.getElementById('user-senha-field');
    const senhaHelp = document.getElementById('user-senha-help');
    const nivelField = document.getElementById('user-nivel-field');
    
    if (!modal || !form) return;
    
    form.reset();
    
    if (userId) {
        // Modo Edição
        const user = allUsers.find(u => u.id === userId);
        if (!user) return;
        
        title.innerHTML = `<i class="fas fa-user-edit" style="color: var(--primary);"></i> Editar Usuário`;
        idField.value = user.id;
        nomeField.value = user.nome;
        emailField.value = user.usuario;
        
        senhaField.required = false;
        senhaField.placeholder = "Deixe em branco para manter";
        senhaHelp.style.display = 'block';
        nivelField.value = user.nivel_acesso;
    } else {
        // Modo Adição
        title.innerHTML = `<i class="fas fa-user-plus" style="color: var(--primary);"></i> Novo Usuário`;
        idField.value = "";
        
        senhaField.required = true;
        senhaField.placeholder = "••••••••";
        senhaHelp.style.display = 'none';
        nivelField.value = "usuario";
    }
    
    modal.style.display = 'flex';
}

function closeUserModal() {
    const modal = document.getElementById('user-modal');
    if (modal) modal.style.display = 'none';
}

async function saveUserForm(event) {
    event.preventDefault();
    
    const id = document.getElementById('user-id-field').value;
    const nome = document.getElementById('user-nome-field').value;
    const email = document.getElementById('user-email-field').value;
    const senha = document.getElementById('user-senha-field').value;
    const nivel_acesso = document.getElementById('user-nivel-field').value;
    
    const payload = { nome, usuario: email, nivel_acesso };
    if (senha) payload.senha = senha;
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        
        let res;
        if (id) {
            // Edição
            res = await fetch(`/api/admin/usuarios/${id}`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`
                },
                body: JSON.stringify(payload)
            });
        } else {
            // Criação
            res = await fetch('/api/admin/usuarios', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`
                },
                body: JSON.stringify(payload)
            });
        }
        
        if (res.ok) {
            showToast("Usuário salvo com sucesso!");
            closeUserModal();
            loadUsers();
        } else {
            const errData = await res.json();
            showToast("Erro: " + (errData.detail || "Não foi possível salvar o usuário"), "error");
        }
    } catch (err) {
        showToast("Erro de conexão com o servidor.", "error");
    }
}

async function deleteUser(userId) {
    if (!confirm("Tem certeza que deseja excluir este usuário?")) {
        return;
    }
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch(`/api/admin/usuarios/${userId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${session?.access_token}` }
        });
        
        if (res.ok) {
            showToast("Usuário excluído com sucesso!");
            loadUsers();
        } else {
            showToast("Erro ao excluir usuário.", "error");
        }
    } catch (err) {
        showToast("Erro de conexão.", "error");
    }
}

// --- GESTÃO DE GASES ---
let allGases = [];

async function loadGases() {
    const container = document.getElementById('gas-list-container');
    if (!container) return;
    
    try {
        const res = await fetch('/api/gases');
        if (res.ok) {
            allGases = await res.json();
            renderGasesList(allGases);
        } else {
            container.innerHTML = `<p style="text-align: center; color: var(--danger); padding: 2rem;">Erro ao carregar gases.</p>`;
        }
    } catch (err) {
        container.innerHTML = `<p style="text-align: center; color: var(--danger); padding: 2rem;">Erro ao conectar ao servidor.</p>`;
    }
}

function renderGasesList(gases) {
    const container = document.getElementById('gas-list-container');
    if (!container) return;
    
    container.style.display = 'grid';
    container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
    container.style.gap = '16px';
    
    container.innerHTML = gases.map(g => {
        return `
        <div class="list-item" style="padding: 16px; background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.06); border-top: 4px solid var(--primary); display: flex; flex-direction: column; justify-content: space-between; min-height: 120px; margin-bottom: 0;">
            <div>
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 6px;">
                    <h4 style="margin: 0; font-size: 0.95rem; color: var(--dark); font-weight: 700; line-height: 1.3; word-break: break-word;">${g.nome}</h4>
                    <div style="display: flex; gap: 4px;">
                        <button onclick="openGasModal(${g.id})" class="btn btn-outline" style="border: none; color: var(--primary); padding: 4px 6px; width: auto; font-size: 0.85rem; background: transparent; cursor: pointer;" title="Editar Gás">
                            <i class="fas fa-pencil-alt"></i>
                        </button>
                        <button onclick="deleteGas(${g.id})" class="btn btn-outline" style="border: none; color: var(--danger); padding: 4px 6px; width: auto; font-size: 0.85rem; background: transparent; cursor: pointer;" title="Excluir Gás">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </div>
                <p style="font-size: 0.8rem; color: #666; margin: 0 0 12px 0; display: flex; align-items: center; gap: 6px;">
                    <i class="fas fa-calendar-alt" style="color: #bbb;"></i> Validade padrão: ${g.validade_anos} ano(s)
                </p>
            </div>
        </div>
        `;
    }).join('') || `<p style="text-align: center; color: #999; padding: 2rem; grid-column: 1 / -1;">Nenhum gás cadastrado.</p>`;
}

function openGasModal(gasId = null) {
    const modal = document.getElementById('gas-modal');
    if (!modal) return;
    
    const title = document.getElementById('gas-modal-title');
    const idField = document.getElementById('gas-id-field');
    const nomeField = document.getElementById('gas-nome-field');
    const validadeField = document.getElementById('gas-validade-field');
    
    if (gasId) {
        title.innerHTML = `<i class="fas fa-flask" style="color: var(--primary);"></i> Editar Gás`;
        const gas = allGases.find(g => g.id === gasId);
        if (gas) {
            idField.value = gas.id;
            nomeField.value = gas.nome;
            validadeField.value = gas.validade_anos;
        }
    } else {
        title.innerHTML = `<i class="fas fa-flask" style="color: var(--primary);"></i> Novo Gás`;
        idField.value = "";
        nomeField.value = "";
        validadeField.value = "";
    }
    
    modal.style.display = 'flex';
}

function closeGasModal() {
    const modal = document.getElementById('gas-modal');
    if (modal) modal.style.display = 'none';
}

async function saveGasForm(event) {
    event.preventDefault();
    
    const id = document.getElementById('gas-id-field').value;
    const nome = document.getElementById('gas-nome-field').value;
    const validade_anos = document.getElementById('gas-validade-field').value;
    
    const formData = new FormData();
    formData.append('nome', nome);
    formData.append('validade_anos', validade_anos);
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        
        let res;
        if (id) {
            res = await fetch(`/api/gases/${id}`, {
                method: 'PUT',
                headers: { 
                    'Authorization': `Bearer ${session?.access_token}`
                },
                body: formData
            });
        } else {
            res = await fetch('/api/gases', {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${session?.access_token}`
                },
                body: formData
            });
        }
        
        if (res.ok) {
            showToast("Gás salvo com sucesso!");
            closeGasModal();
            loadGases();
            loadGasesList(); // reload global cached list too
        } else {
            const errData = await res.json();
            showToast("Erro: " + (errData.detail || "Não foi possível salvar o gás"), "error");
        }
    } catch (err) {
        showToast("Erro de conexão com o servidor.", "error");
    }
}

async function deleteGas(gasId) {
    if (!confirm("Tem certeza que deseja excluir este gás?")) {
        return;
    }
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch(`/api/gases/${gasId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${session?.access_token}` }
        });
        
        if (res.ok) {
            showToast("Gás excluído com sucesso!");
            loadGases();
            loadGasesList(); // reload global cached list too
        } else {
            showToast("Erro ao excluir gás.", "error");
        }
    } catch (err) {
        showToast("Erro de conexão.", "error");
    }
}

async function resendWhatsApp(id, clientName) {
    const rawPhone = prompt(`Digite o número do WhatsApp (com DDD) para reenviar o comprovante de ${clientName}:\nEx: (24) 98888-7777`);
    if (!rawPhone) return;
    
    const phone = rawPhone.replace(/\D/g, '');
    if (phone.length < 10) {
        showToast("Número inválido. Reenvio cancelado.", "error");
        return;
    }
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch(`/api/entregas/${id}/reenviar-whatsapp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session?.access_token}`
            },
            body: JSON.stringify({ whatsapp_phone: phone })
        });
        
        if (res.ok) {
            showToast("Comprovante reenviado com sucesso!");
        } else {
            showToast("Erro ao reenviar comprovante", "error");
        }
    } catch(e) {
        showToast("Erro de conexão", "error");
    }
}

// --- MODO OFFLINE COM INDEXEDDB E FILA DE SINCRONIZAÇÃO ---
let offlineDB = null;
let isSyncing = false;

function initOfflineDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('SSGasOfflineDB', 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('pending_deliveries')) {
                db.createObjectStore('pending_deliveries', { keyPath: 'id', autoIncrement: true });
            }
        };
        request.onsuccess = (e) => {
            offlineDB = e.target.result;
            console.log("[OFFLINE] IndexedDB inicializado com sucesso.");
            updatePendingBadge();
            
            // Tenta sincronizar pendências se iniciarmos online
            if (navigator.onLine) {
                syncPendingDeliveries();
            }
            resolve(offlineDB);
        };
        request.onerror = (e) => {
            console.error("[OFFLINE] Falha ao inicializar IndexedDB:", e.target.error);
            reject(e.target.error);
        };
    });
}

async function updatePendingBadge() {
    const badge = document.getElementById('pending-sync-badge');
    const countEl = document.getElementById('pending-sync-count');
    if (!badge || !countEl) return;
    
    if (!offlineDB) {
        badge.style.display = 'none';
        return;
    }
    
    try {
        const pending = await getPendingDeliveries();
        const count = pending.length;
        if (count > 0) {
            countEl.innerText = count;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    } catch (err) {
        console.error("[OFFLINE] Erro ao atualizar contador de pendências:", err);
    }
}

function getPendingDeliveries() {
    return new Promise((resolve, reject) => {
        if (!offlineDB) {
            resolve([]);
            return;
        }
        const transaction = offlineDB.transaction(['pending_deliveries'], 'readonly');
        const store = transaction.objectStore('pending_deliveries');
        const request = store.getAll();
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

function saveDeliveryOffline(payload, offlinePhotos) {
    return new Promise((resolve, reject) => {
        if (!offlineDB) {
            reject(new Error("Banco offline não inicializado"));
            return;
        }
        
        const record = {
            ...payload,
            offline_photos: offlinePhotos.map(p => ({
                id: p.id,
                blob: p.blob,
                filename: `offline_${p.id}.jpg`
            })),
            is_offline_pending: true,
            created_at: new Date().toISOString()
        };
        
        const transaction = offlineDB.transaction(['pending_deliveries'], 'readwrite');
        const store = transaction.objectStore('pending_deliveries');
        const request = store.add(record);
        
        request.onsuccess = () => {
            updatePendingBadge();
            resolve(true);
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

function deletePendingDelivery(id) {
    return new Promise((resolve, reject) => {
        if (!offlineDB) {
            resolve(false);
            return;
        }
        const transaction = offlineDB.transaction(['pending_deliveries'], 'readwrite');
        const store = transaction.objectStore('pending_deliveries');
        const request = store.delete(id);
        request.onsuccess = () => {
            updatePendingBadge();
            resolve(true);
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

async function syncPendingDeliveries() {
    if (isSyncing) return;
    if (!navigator.onLine) {
        showToast("Sem sinal de internet no momento.", "error");
        return;
    }
    
    if (!offlineDB) return;
    const pending = await getPendingDeliveries();
    if (pending.length === 0) return;
    
    isSyncing = true;
    const syncBar = document.getElementById('sync-bar');
    if (syncBar) syncBar.style.display = 'block';
    
    console.log(`[OFFLINE] Iniciando sincronização de ${pending.length} entrega(s)...`);
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        
        for (const delivery of pending) {
            console.log(`[OFFLINE] Sincronizando entrega do cliente: ${delivery.nome_cliente}`);
            const uploadedUrls = [];
            
            // 1. Upload de fotos offline salvas no IndexedDB
            if (delivery.offline_photos && delivery.offline_photos.length > 0) {
                for (const photo of delivery.offline_photos) {
                    try {
                        const formData = new FormData();
                        formData.append('foto', photo.blob, photo.filename);
                        formData.append('client_name', delivery.nome_cliente || "Offline");
                        formData.append('invoice_number', delivery.numero_documento || "Offline");
                        
                        const photoRes = await fetch('/api/upload-temp-photo', {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${session?.access_token}` },
                            body: formData
                        });
                        
                        if (photoRes.ok) {
                            const data = await photoRes.json();
                            if (data.drive_url) {
                                uploadedUrls.push(data.drive_url);
                            }
                        } else {
                            throw new Error("Erro no upload de foto da entrega pendente");
                        }
                    } catch (photoErr) {
                        console.error("[OFFLINE] Falha ao enviar foto offline:", photoErr);
                        throw photoErr; // Aborta para tentar na próxima oportunidade online
                    }
                }
            }
            
            // Concatena fotos online pré-existentes (se houver) com as novas fotos enviadas agora
            const finalUploadedUrls = [
                ...delivery.fotos_pre_carregadas.filter(url => !url.startsWith('blob:')),
                ...uploadedUrls
            ];
            
            // 2. Enviar a entrega final para a API do Servidor
            const finalPayload = {
                ...delivery,
                fotos_pre_carregadas: finalUploadedUrls
            };
            
            delete finalPayload.id;
            delete finalPayload.offline_photos;
            delete finalPayload.is_offline_pending;
            delete finalPayload.created_at;
            
            const res = await fetch('/api/entregas', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`
                },
                body: JSON.stringify(finalPayload)
            });
            
            if (res.ok) {
                console.log(`[OFFLINE] Entrega de ${delivery.nome_cliente} sincronizada e salva com sucesso!`);
                await deletePendingDelivery(delivery.id);
            } else {
                throw new Error(`Erro na API ao enviar entrega: ${res.statusText}`);
            }
        }
        
        showToast("Todas as entregas pendentes foram sincronizadas!", "success");
    } catch (err) {
        console.error("[OFFLINE] Falha na sincronização:", err);
        showToast("Sincronização interrompida. Tentaremos novamente com sinal estável.", "error");
    } finally {
        isSyncing = false;
        if (syncBar) syncBar.style.display = 'none';
        updatePendingBadge();
    }
}

// Ouvintes automáticos de rede para o PWA
window.addEventListener('online', () => {
    const offlineBar = document.getElementById('offline-bar');
    if (offlineBar) offlineBar.style.display = 'none';
    showToast("Conexão com a internet restabelecida!", "success");
    syncPendingDeliveries();
});

window.addEventListener('offline', () => {
    const offlineBar = document.getElementById('offline-bar');
    if (offlineBar) offlineBar.style.display = 'block';
    showToast("Você está desconectado. O app agora opera em modo offline.", "warning");
});

// Verifica estado de rede inicial ao carregar a página
function checkInitialNetwork() {
    const offlineBar = document.getElementById('offline-bar');
    if (!navigator.onLine && offlineBar) {
        offlineBar.style.display = 'block';
    }
}

async function syncMarcas() {
    try {
        const res = await fetch('/api/marcas');
        if (res.ok) {
            const dbMarcas = await res.json();
            let localMarcas = JSON.parse(localStorage.getItem('gas_marcas') || '["White Martins", "IBG", "Air Liquide", "Messer"]');
            
            // remove empty strings if any
            localMarcas = localMarcas.filter(m => m.trim() !== '');
            let dbClean = dbMarcas.filter(m => m && m.trim() !== '');
            
            let all = [...new Set([...localMarcas, ...dbClean])];
            localStorage.setItem('gas_marcas', JSON.stringify(all));
        }
    } catch(e) {
        console.log("Offline: couldn't sync marcas");
    }
}

initSupabase();
checkInitialNetwork();
syncMarcas();
loadGasesList();
