from fastapi import FastAPI, Request, HTTPException, Depends, UploadFile, File, Form
from sqlalchemy import create_engine, and_
from sqlalchemy.orm import sessionmaker, Session
from models import Base, Usuario, Cliente, Entrega, CilindroAplicado
from storage import upload_file_to_drive
from auth import get_current_user, role_required
from fastapi.middleware.cors import CORSMiddleware
import os
import json
import httpx
from datetime import datetime, timezone
from typing import List, Optional
from supabase import create_client, Client
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Setup Database
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./test.db")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI()

# --- Supabase SSO ---
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY")
if SUPABASE_URL and SUPABASE_ANON_KEY:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
else:
    supabase = None

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # For dev, allow all. In prod, restrict to app URL.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve Frontend Static Files
app.mount("/static", StaticFiles(directory="frontend"), name="static")

@app.get("/api/config")
async def get_config():
    return {
        "url": SUPABASE_URL,
        "key": SUPABASE_ANON_KEY
    }

@app.get("/")
async def read_index():
    return FileResponse("frontend/index.html")

@app.get("/style.css")
async def read_css():
    return FileResponse("frontend/style.css")

@app.get("/app.js")
async def read_js():
    return FileResponse("frontend/app.js")

@app.get("/manifest.json")
async def read_manifest():
    return FileResponse("frontend/manifest.json")

# Serve assets folder
app.mount("/assets", StaticFiles(directory="assets"), name="assets")

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/api/cnpj/{documento}")
async def focus_cnpj(documento: str, db: Session = Depends(get_db)):
    # 1. Check local DB first for either CPF or CNPJ
    cliente = db.query(Cliente).filter(Cliente.cnpj == documento).first()
    if cliente:
        return {"cnpj": cliente.cnpj, "nome_razao": cliente.nome_razao, "fonte": "local"}

    # 2. If it's a CNPJ (14 digits), search via BrasilAPI
    if len(documento) == 14:
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(f"https://brasilapi.com.br/api/cnpj/v1/{documento}")
                if response.status_code == 200:
                    data = response.json()
                    return {
                        "cnpj": documento,
                        "nome_razao": data.get("razao_social"),
                        "fonte": "externa"
                    }
                else:
                    raise HTTPException(status_code=404, detail="CNPJ não encontrado na Receita Federal")
            except httpx.RequestError:
                raise HTTPException(status_code=503, detail="Erro de conexão com a API externa")
    
    # 3. If it's a CPF (11 digits) or anything else not found locally, throw 404
    # This will trigger the mobile app to prompt for manual registration
    raise HTTPException(status_code=404, detail="Documento não encontrado na base local. Favor cadastrar manualmente.")

@app.post("/api/clientes")
async def save_cliente(data: dict, db: Session = Depends(get_db)):
    cnpj = data.get('cnpj')
    nome_razao = data.get('nome_razao')
    
    cliente = db.query(Cliente).filter(Cliente.cnpj == cnpj).first()
    if cliente:
        cliente.nome_razao = nome_razao
    else:
        cliente = Cliente(cnpj=cnpj, nome_razao=nome_razao)
        db.add(cliente)
    
    db.commit()
    return {"status": "success"}

@app.post("/api/entregas")
async def create_entrega(
    payload: str = Form(...),
    fotos: List[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    try:
        data = json.loads(payload)
    except:
        raise HTTPException(status_code=400, detail="Payload JSON inválido")

    cnpj = data.get('cnpj')
    numero_documento = data.get('numero_documento')
    data_entrega_str = data.get('data_entrega') # ISO string
    tipo_entrega = data.get('tipo_entrega') # 'motorista' or 'retirada'
    cilindros_data = data.get('cilindros', [])

    cliente = db.query(Cliente).filter(Cliente.cnpj == cnpj).first()
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")

    try:
        data_entrega_parsed = datetime.fromisoformat(data_entrega_str.replace('Z', '+00:00')) if data_entrega_str else datetime.utcnow()
    except ValueError:
        data_entrega_parsed = datetime.utcnow()

    # Create Entrega
    entrega = Entrega(
        numero_documento=numero_documento,
        fk_cliente=cnpj,
        fk_motorista=current_user['id'],
        data_aplicacao=datetime.utcnow(),
        data_entrega=data_entrega_parsed,
        tipo_entrega=tipo_entrega
    )
    db.add(entrega)
    db.commit()
    db.refresh(entrega)

    # Process Cilindros and Photos
    photo_urls = []
    os.makedirs("temp", exist_ok=True)
    if fotos:
        for foto in fotos:
            content = await foto.read()
            file_path = os.path.join("temp", foto.filename)
            with open(file_path, "wb") as f:
                f.write(content)
            
            # Upload to Drive
            drive_url = upload_file_to_drive(file_path, cliente.nome_razao, numero_documento, entrega.data_entrega)
            photo_urls.append(drive_url)
            os.remove(file_path)

    # Create cilindros and map photos
    # The frontend sends 'fotos' as a list. We need to map them back to cylinders.
    # We use the naming convention 'cil_{cIdx}_{pIdx}_{filename}' set in the frontend.
    cilindros_objects = []
    
    # Pre-sort photos by cylinder index
    photo_map = {} # cil_idx -> [url1, url2, ...]
    for i, file in enumerate(fotos):
        filename = file.filename
        if filename.startswith('cil_'):
            try:
                parts = filename.split('_')
                c_idx = int(parts[1])
                if c_idx not in photo_map:
                    photo_map[c_idx] = []
                photo_map[c_idx].append(photo_urls[i])
            except (IndexError, ValueError):
                pass

    for i, cil in enumerate(cilindros_data):
        # Join multiple photo URLs with a comma for storage
        urls = ",".join(photo_map.get(i, []))
        cilindro = CilindroAplicado(
            fk_entrega=entrega.id,
            tipo_gas=cil.get('tipo_gas'),
            tamanho_gas=cil.get('tamanho_gas'),
            quantidade=cil.get('qtd', 1),
            data_validade=cil.get('validade'),
            url_foto=urls if urls else None
        )
        db.add(cilindro)
        cilindros_objects.append(cilindro)

    # Generate PDF Report
    from reports import generate_delivery_pdf
    pdf_filename = f"Relatorio_{numero_documento}.pdf"
    pdf_path = os.path.join("temp", pdf_filename)
    generate_delivery_pdf(entrega, cliente, cilindros_objects, pdf_path)
    
    # Upload PDF to Drive
    pdf_drive_url = upload_file_to_drive(pdf_path, cliente.nome_razao, numero_documento, entrega.data_entrega)
    os.remove(pdf_path)

    db.commit()
    return {
        "status": "success", 
        "entrega_id": entrega.id, 
        "pdf_url": pdf_drive_url,
        "photo_urls": photo_urls
    }

@app.get("/api/usuarios", dependencies=[Depends(get_current_user)])
@role_required(["adm"])
async def list_usuarios(db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    return db.query(Usuario).all()

@app.post("/api/usuarios", dependencies=[Depends(get_current_user)])
@role_required(["adm"])
async def create_usuario(data: dict, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    # In a real app, hash the password
    new_user = Usuario(
        nome=data.get('nome'),
        usuario=data.get('usuario'),
        senha_hash=data.get('senha'), # Should be hashed
        nivel_acesso=data.get('nivel_acesso')
    )
    db.add(new_user)
    db.commit()
    return {"status": "success"}

@app.put("/api/usuarios/{user_id}", dependencies=[Depends(get_current_user)])
@role_required(["adm"])
async def update_usuario(user_id: int, data: dict, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    
    user.nome = data.get('nome', user.nome)
    user.usuario = data.get('usuario', user.usuario)
    if data.get('senha'):
        user.senha_hash = data.get('senha')
    user.nivel_acesso = data.get('nivel_acesso', user.nivel_acesso)
    
    db.commit()
    return {"status": "success"}

@app.delete("/api/usuarios/{user_id}", dependencies=[Depends(get_current_user)])
@role_required(["adm"])
async def delete_usuario(user_id: int, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    
    db.delete(user)
    db.commit()
    return {"status": "success"}

@app.get("/api/clientes/{cnpj}/historico")
async def get_historico(cnpj: str, db: Session = Depends(get_db)):
    entregas = db.query(Entrega).filter(Entrega.fk_cliente == cnpj).order_by(Entrega.data_entrega.desc()).all()
    
    result = []
    for entrega in entregas:
        cilindros = db.query(CilindroAplicado).filter(CilindroAplicado.fk_entrega == entrega.id).all()
        result.append({
            "id": entrega.id,
            "documento": entrega.numero_documento,
            "data": entrega.data_entrega.isoformat(),
            "tipo_entrega": entrega.tipo_entrega,
            "cilindros": [
                {
                    "tipo_gas": c.tipo_gas,
                    "tamanho_gas": c.tamanho_gas,
                    "quantidade": c.quantidade,
                    "validade": c.data_validade,
                    "foto": c.url_foto
                } for c in cilindros
            ]
        })
    
    return result

@app.get("/api/auth/sso-login")
def sso_login(sso_token: str, db: Session = Depends(get_db)):
    if not supabase:
        raise HTTPException(status_code=500, detail="Configuração de SSO ausente.")
        
    try:
        # 1. Validar token no Supabase
        now_utc = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        res = supabase.table("sso_tokens") \
            .select("user_email") \
            .eq("id", sso_token) \
            .gt("expires_at", now_utc) \
            .is_("used_at", "null") \
            .execute()
        
        if not res.data:
            raise HTTPException(status_code=401, detail="Token SSO inválido ou expirado.")
        
        user_email = res.data[0]["user_email"]
        
        # 2. Marcar como usado
        used_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        supabase.table("sso_tokens").update({"used_at": used_at}).eq("id", sso_token).execute()
        
        # 3. Buscar usuário no banco local
        # No SS Gas Control, a tabela é 'Usuario' e o campo é 'usuario'
        user = db.query(Usuario).filter(Usuario.usuario == user_email).first()
        if not user:
            raise HTTPException(status_code=404, detail="Usuário não cadastrado neste sistema.")
            
        # 4. Gerar Token (O SS Gas Control parece usar um JWT simples)
        # Como o SS Gas Control não tem uma função create_access_token definida em main.py,
        # vamos retornar os dados do usuário e o status de sucesso.
        # NOTA: O fluxo de token real depende de como o mobile lida com isso.
        return {
            "status": "success",
            "token": f"SSO_{sso_token}", # Placeholder, ideal seria gerar o JWT real aqui
            "user": {
                "id": user.id,
                "nome": user.nome,
                "usuario": user.usuario,
                "nivel_acesso": user.nivel_acesso
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
