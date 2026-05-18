from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from typing import List, Optional
import json
import os
from datetime import datetime

from database import get_db, engine
import models
from models import Base, Cliente, Entrega, CilindroAplicado, Usuario
from auth import get_current_user, create_access_token
from storage import upload_file_to_drive

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="SS Gas Control API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/config")
async def get_config():
    return {"url": os.getenv("SUPABASE_URL"), "key": os.getenv("SUPABASE_ANON_KEY")}

@app.get("/api/cnpj/{doc}")
async def get_cnpj_info(doc: str, db: Session = Depends(get_db)):
    cliente = db.query(Cliente).filter(Cliente.cnpj == doc).first()
    if cliente: return {"nome_razao": cliente.nome_razao}
    return HTTPException(status_code=404, detail="Não encontrado")

@app.post("/api/entregas")
async def criar_entrega(
    payload: str = Form(...),
    fotos: List[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    print(f"--- [RASTREIO] NOVA REQUISIÇÃO RECEBIDA ---")
    data = json.loads(payload)
    cnpj = data.get('cnpj')
    nome_cliente = data.get('nome_cliente')
    
    cliente = db.query(Cliente).filter(Cliente.cnpj == cnpj).first()
    if not cliente:
        cliente = Cliente(cnpj=cnpj, nome_razao=nome_cliente, lat=data.get('lat'), lng=data.get('lng'))
        db.add(cliente)
    else:
        if data.get('lat'): cliente.lat = data.get('lat'); cliente.lng = data.get('lng')

    entrega = Entrega(
        numero_documento=data.get('numero_documento'),
        nome_cliente=nome_cliente,  # salva direto para nunca perder
        data_entrega=datetime.fromisoformat(data.get('data_entrega').replace('Z', '')),
        tipo_entrega='motorista',
        fk_cliente=cnpj if cnpj else None,
        fk_motorista=current_user.id,
        lat=data.get('lat'),
        lng=data.get('lng')
    )
    db.add(entrega)
    db.flush()
    print(f"[RASTREIO] Entrega {entrega.id} | Cliente: {nome_cliente} | CNPJ: {cnpj}")

    photo_urls = []
    if fotos:
        os.makedirs("temp", exist_ok=True)
        for foto in fotos:
            content = await foto.read()
            file_path = os.path.join("temp", f"{datetime.now().timestamp()}_{foto.filename}")
            with open(file_path, "wb") as f: f.write(content)
            try:
                url = upload_file_to_drive(file_path, cliente.nome_razao, entrega.numero_documento, entrega.data_entrega)
                photo_urls.append(url)
            except Exception as e: print(f"[ERRO DRIVE] {e}")
            finally: 
                if os.path.exists(file_path): os.remove(file_path)
    
    entrega.fotos_urls = ",".join(photo_urls) if photo_urls else None

    for cil in data.get('cilindros', []):
        item = CilindroAplicado(
            fk_entrega=entrega.id,
            tipo_gas=cil.get('tipo_gas'),
            tamanho_gas=cil.get('tamanho_gas'),
            quantidade=int(cil.get('qtd', 1)),
            observacao=cil.get('obs')
        )
        db.add(item)

    db.commit()
    return {"status": "success", "id": entrega.id}

@app.get("/api/entregas/filtro")
async def filtrar_entregas(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db)
):
    query = db.query(Entrega).outerjoin(Cliente)
    
    if start_date and start_date != "":
        try: query = query.filter(Entrega.data_entrega >= datetime.strptime(start_date, "%Y-%m-%d"))
        except: pass
    if end_date and end_date != "":
        try: query = query.filter(Entrega.data_entrega <= datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59))
        except: pass
    if search:
        query = query.filter((Cliente.nome_razao.ilike(f"%{search}%")) | (Cliente.cnpj.ilike(f"%{search}%")) | (Entrega.numero_documento.ilike(f"%{search}%")))
    
    entregas = query.order_by(Entrega.data_entrega.desc()).limit(50).all()
    
    result = []
    print(f"--- [DEBUG HISTÓRICO] Encontradas {len(entregas)} entregas ---")
    for e in entregas:
        # Fallback em 3 níveis: 1) relação ORM, 2) lookup manual, 3) campo nome_cliente da entrega
        nome = None
        if e.cliente:
            nome = e.cliente.nome_razao
        if not nome and e.fk_cliente:
            c = db.query(Cliente).filter(Cliente.cnpj == e.fk_cliente).first()
            if c:
                nome = c.nome_razao
        if not nome:
            nome = e.nome_cliente  # campo direto salvo no registro
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

@app.get("/api/clientes")
async def listar_clientes(db: Session = Depends(get_db)):
    clientes = db.query(Cliente).all()
    return [{"cnpj": c.cnpj, "nome_razao": c.nome_razao, "lat": c.lat, "lng": c.lng} for c in clientes]

app.mount("/assets", StaticFiles(directory="assets"), name="assets")
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
