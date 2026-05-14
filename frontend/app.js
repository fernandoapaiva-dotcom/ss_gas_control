// SS Gas Control - Logic
let supabaseClient;
let currentUser = null;

// Initialize Supabase
async function initSupabase() {
    try {
        const response = await fetch('/api/config');
        const config = await response.json();
        // The global object from the CDN is 'supabase'
        supabaseClient = window.supabase.createClient(config.url, config.key);
        
        supabaseClient.auth.onAuthStateChange((event, session) => {
            console.log("Auth Event:", event);
            if (session) {
                handleAuthSuccess(session.user);
            } else {
                showView('login-view');
                document.getElementById('main-header').style.display = 'none';
            }
        });
    } catch (err) {
        console.error("Erro ao carregar configurações:", err);
    }
}

function handleAuthSuccess(user) {
    currentUser = user;
    document.getElementById('login-view').classList.remove('active');
    document.getElementById('main-header').style.display = 'block';
    document.getElementById('user-name').innerText = user.email;
    
    if (user.email.includes('admin') || 
        user.email === 'comercial@servweld.com.br' || 
        user.email === 'comer@servsolda.com.br') {
        document.getElementById('admin-nav-btn').style.display = 'block';
    }
    
    showView('driver-view');
}

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const view = document.getElementById(viewId);
    if (view) view.classList.add('active');
    
    if (viewId === 'admin-view') {
        loadAdminData();
    }
}

// Login Logic
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('login-error');
    const btn = e.target.querySelector('button');
    
    errorDiv.style.display = 'none';
    btn.disabled = true;
    btn.innerText = "Entrando...";
    
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    
    if (error) {
        errorDiv.innerText = "Falha no login: " + error.message;
        errorDiv.style.display = 'block';
        btn.disabled = false;
        btn.innerText = "Entrar";
    }
});

// Logout
document.getElementById('logout-btn').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
});

// Client Search
document.getElementById('search-client').addEventListener('click', async () => {
    const doc = document.getElementById('client-doc').value;
    if (!doc) return;
    
    const infoDiv = document.getElementById('client-info');
    infoDiv.style.display = 'block';
    infoDiv.innerText = "Buscando...";
    
    try {
        const res = await fetch(`/api/cnpj/${doc.replace(/\D/g, '')}`);
        if (res.ok) {
            const data = await res.json();
            infoDiv.innerText = data.nome_razao;
            infoDiv.style.color = "var(--success)";
        } else {
            infoDiv.innerText = "Cliente não encontrado. Será cadastrado ao finalizar.";
            infoDiv.style.color = "var(--warning)";
        }
    } catch (err) {
        infoDiv.innerText = "Erro ao buscar cliente.";
    }
});

// Delivery Items Management
let itemCounter = 0;
function addItem() {
    const container = document.getElementById('items-container');
    const div = document.createElement('div');
    div.className = 'card';
    div.style.marginBottom = '1rem';
    div.innerHTML = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 1rem;">
            <h4>Cilindro #${++itemCounter}</h4>
            <button type="button" class="btn btn-outline" style="color: var(--danger); border-color: var(--danger); padding: 0.2rem 0.5rem;" onclick="this.parentElement.parentElement.remove()">
                <i class="fas fa-trash"></i>
            </button>
        </div>
        <div class="form-group">
            <label>Tipo de Gás</label>
            <select class="form-control" name="tipo_gas">
                <option value="Oxigênio">Oxigênio</option>
                <option value="Acetileno">Acetileno</option>
                <option value="Argônio">Argônio</option>
                <option value="Mistura">Mistura</option>
                <option value="CO2">CO2</option>
                <option value="Nitrogênio">Nitrogênio</option>
            </select>
        </div>
        <div class="form-group">
            <label>Tamanho</label>
            <select class="form-control" name="tamanho_gas">
                <option value="1m3">1m³</option>
                <option value="3m3">3m³</option>
                <option value="7m3">7m³</option>
                <option value="10m3">10m³</option>
                <option value="P45">P45</option>
            </select>
        </div>
        <div class="form-group">
            <label>Foto do Cilindro / Validade</label>
            <input type="file" class="form-control" name="foto" accept="image/*" capture="environment">
        </div>
    `;
    container.appendChild(div);
}

document.getElementById('add-item').addEventListener('click', addItem);
addItem(); // Init first item

// Delivery Submission
document.getElementById('delivery-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
    
    const formData = new FormData();
    const payload = {
        cnpj: document.getElementById('client-doc').value.replace(/\D/g, ''),
        numero_documento: document.getElementById('doc-number').value,
        data_entrega: new Date().toISOString(),
        tipo_entrega: 'motorista',
        cilindros: []
    };
    
    const itemCards = document.querySelectorAll('#items-container .card');
    itemCards.forEach((card, idx) => {
        const tipo = card.querySelector('[name="tipo_gas"]').value;
        const tamanho = card.querySelector('[name="tamanho_gas"]').value;
        const fileInput = card.querySelector('[name="foto"]');
        
        payload.cilindros.push({
            tipo_gas: tipo,
            tamanho_gas: tamanho,
            qtd: 1
        });
        
        if (fileInput.files[0]) {
            formData.append('fotos', fileInput.files[0], `cil_${idx}_0_${fileInput.files[0].name}`);
        }
    });
    
    formData.append('payload', JSON.stringify(payload));
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch('/api/entregas', {
            method: 'POST',
            body: formData,
            headers: {
                'Authorization': `Bearer ${session?.access_token}`
            }
        });
        
        if (res.ok) {
            alert("Entrega registrada com sucesso!");
            location.reload();
        } else {
            const errData = await res.json();
            alert("Erro ao salvar entrega: " + (errData.detail || "Erro desconhecido"));
        }
    } catch (err) {
        alert("Erro de conexão.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
});

// Admin Data Loading
async function loadAdminData() {
    const historyList = document.getElementById('history-list');
    const userList = document.getElementById('user-list');
    
    try {
        historyList.innerHTML = '<p style="color: var(--secondary)">Acesse o Google Drive para ver os relatórios completos.</p>';
        
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch('/api/usuarios', {
            headers: { 'Authorization': `Bearer ${session?.access_token}` }
        });
        
        if (res.ok) {
            const users = await res.json();
            userList.innerHTML = users.map(u => `
                <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--gray-200);">
                    <span><strong>${u.nome}</strong> (${u.usuario})</span>
                    <span class="badge" style="background: var(--primary-light); color: var(--primary); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.7rem;">${u.nivel_acesso.toUpperCase()}</span>
                </div>
            `).join('') || '<p>Nenhum usuário cadastrado localmente.</p>';
        }
    } catch (err) {
        console.error("Erro ao carregar dados admin:", err);
    }
}

// Start
initSupabase();
