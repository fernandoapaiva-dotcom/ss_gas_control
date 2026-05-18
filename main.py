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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- API ROUTES ---

@app.get("/api/config")
async def get_config():
    return {"url": SUPABASE_URL, "key": SUPABASE_ANON_KEY}

@app.get("/api/usuarios/me")
async def get_current_user_details(db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    user = db.query(Usuario).filter(Usuario.id == current_user['id']).first()
    return user

@app.get("/api/clientes")
async def list_clientes(db: Session = Depends(get_db)):
    clientes = db.query(Cliente).all()
    return [{"cnpj": c.cnpj, "nome_razao": c.nome_razao, "lat": c.lat, "lng": c.lng} for c in clientes]

@app.post("/api/clientes/localizacao")
async def update_cliente_localizacao(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    cnpj = payload.get("cnpj")
    lat = payload.get("lat")
    lng = payload.get("lng")
    
    if not cnpj:
        raise HTTPException(status_code=400, detail="CNPJ é obrigatório")
        
    cliente = db.query(Cliente).filter(Cliente.cnpj == cnpj).first()
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
        
    cliente.lat = lat
    cliente.lng = lng
    db.commit()
    return {"status": "success", "lat": lat, "lng": lng}

@app.get("/api/cnpj/{documento}")
async def focus_cnpj(documento: str, db: Session = Depends(get_db)):
    print(f"[RASTREIO] Buscando CNPJ: {documento}")
    cliente = db.query(Cliente).filter(Cliente.cnpj == documento).first()
    if cliente:
        return {"cnpj": cliente.cnpj, "nome_razao": cliente.nome_razao, "fonte": "local"}

    if len(documento) == 14:
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(f"https://brasilapi.com.br/api/cnpj/v1/{documento}")
                if response.status_code == 200:
                    data = response.json()
                    return {"cnpj": documento, "nome_razao": data.get("razao_social"), "fonte": "externa"}
            except Exception as e:
                print(f"[RASTREIO] Erro BrasilAPI: {str(e)}")

    raise HTTPException(status_code=404, detail="Não encontrado")

@app.post("/api/entregas")
async def create_entrega(
    payload: str = Form(...),
    fotos: List[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    print(f"\n--- [RASTREIO] NOVA REQUISIÇÃO RECEBIDA ---")
    try:
        data = json.loads(payload)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Payload JSON inválido")

    cnpj = data.get('cnpj')
    nome_cliente = data.get('nome_cliente', 'Cliente Novo')
    numero_documento = data.get('numero_documento')
    data_entrega_str = data.get('data_entrega')
    tipo_entrega = data.get('tipo_entrega')
    cilindros_data = data.get('cilindros', [])

    cliente = db.query(Cliente).filter(Cliente.cnpj == cnpj).first()
    if not cliente:
        cliente = Cliente(cnpj=cnpj, nome_razao=nome_cliente, lat=data.get('lat'), lng=data.get('lng'))
        db.add(cliente)
        db.commit()
        db.refresh(cliente)
    else:
        if data.get('lat'):
            cliente.lat = data.get('lat')
            cliente.lng = data.get('lng')
            db.commit()

    try:
        data_entrega_parsed = datetime.fromisoformat(data_entrega_str.replace('Z', '+00:00')) if data_entrega_str else datetime.utcnow()
    except:
        data_entrega_parsed = datetime.utcnow()

    entrega = Entrega(
        numero_documento=numero_documento,
        nome_cliente=nome_cliente,
        fk_cliente=cnpj if cnpj else None,
        fk_motorista=current_user['id'],
        data_aplicacao=datetime.utcnow(),
        data_entrega=data_entrega_parsed,
        tipo_entrega=tipo_entrega,
        lat=data.get('lat'),
        lng=data.get('lng')
    )
    db.add(entrega)
    db.commit()
    db.refresh(entrega)
    print(f"[RASTREIO] Entrega {entrega.id} | Cliente: {nome_cliente} | CNPJ: {cnpj}")

    photo_urls = []
    os.makedirs("temp", exist_ok=True)
    if fotos:
        for i, foto in enumerate(fotos):
            content = await foto.read()
            file_path = os.path.join("temp", f"temp_{i}_{foto.filename}")
            with open(file_path, "wb") as f:
                f.write(content)
            try:
                drive_url = upload_file_to_drive(file_path, cliente.nome_razao, numero_documento, entrega.data_entrega)
                photo_urls.append(drive_url)
            except Exception as e:
                print(f"[RASTREIO] Erro ao subir foto {i}: {str(e)}")
            finally:
                if os.path.exists(file_path):
                    os.remove(file_path)

    if photo_urls:
        entrega.fotos_urls = ",".join(photo_urls)
        db.commit()

    for cil in cilindros_data:
        cilindro = CilindroAplicado(
            fk_entrega=entrega.id,
            tipo_gas=cil.get('tipo_gas'),
            tamanho_gas=cil.get('tamanho_gas'),
            quantidade=cil.get('qtd', 1),
            data_validade=cil.get('validade') or "-",
            observacao=cil.get('obs')
        )
        db.add(cilindro)

    db.commit()
    return {"status": "success", "id": entrega.id, "photos": photo_urls}

@app.get("/api/entregas/filtro")
async def filtrar_entregas(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    query = db.query(Entrega).outerjoin(Cliente, Entrega.fk_cliente == Cliente.cnpj)

    if start_date:
        try:
            query = query.filter(Entrega.data_entrega >= datetime.strptime(start_date, "%Y-%m-%d"))
        except: pass
    if end_date:
        try:
            query = query.filter(Entrega.data_entrega <= datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59))
        except: pass
    if search:
        query = query.filter(
            (Cliente.nome_razao.ilike(f"%{search}%")) |
            (Cliente.cnpj.ilike(f"%{search}%")) |
            (Entrega.nome_cliente.ilike(f"%{search}%")) |
            (Entrega.numero_documento.ilike(f"%{search}%"))
        )

    entregas = query.order_by(Entrega.data_entrega.desc()).limit(50).all()

    result = []
    print(f"--- [DEBUG HISTÓRICO] Encontradas {len(entregas)} entregas ---")
    for e in entregas:
        nome = None
        if e.cliente:
            nome = e.cliente.nome_razao
        if not nome and e.fk_cliente:
            c = db.query(Cliente).filter(Cliente.cnpj == e.fk_cliente).first()
            if c:
                nome = c.nome_razao
        if not nome:
            nome = e.nome_cliente
        nome = nome or "Cliente Desconhecido"

        print(f"ID: {e.id} | Cliente: {nome} | Data: {e.data_entrega} | NF: {e.numero_documento}")

        result.append({
            "id": e.id,
            "data": e.data_entrega.isoformat() if e.data_entrega else None,
            "nf": e.numero_documento or "S/N",
            "cliente": nome,
            "fotos": e.fotos_urls.split(",") if e.fotos_urls else [],
            "itens": [{"gas": i.tipo_gas, "tam": i.tamanho_gas, "qtd": i.quantidade, "obs": i.observacao} for i in e.cilindros]
        })
    return result

@app.get("/api/deletar_entrega/{id}")
async def deletar_entrega(id: int, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    entrega = db.query(Entrega).filter(Entrega.id == id).first()
    if not entrega:
        raise HTTPException(status_code=404, detail="Entrega não encontrada")
    db.delete(entrega)
    db.commit()
    return {"status": "deleted"}

# --- STATIC FILES ---
app.mount("/assets", StaticFiles(directory="assets"), name="assets")
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
