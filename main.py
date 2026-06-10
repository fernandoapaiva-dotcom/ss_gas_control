from fastapi import FastAPI, Request, HTTPException, Depends, UploadFile, File, Form, BackgroundTasks
from sqlalchemy import create_engine, and_
from sqlalchemy.orm import sessionmaker, Session
from models import Base, Usuario, Cliente, Entrega, CilindroAplicado
from storage import upload_file_to_drive, upload_temp_file_to_drive, delete_file_from_drive, get_drive_service, get_google_config, CONFIG_PATH
from auth import get_current_user, role_required
from fastapi.middleware.cors import CORSMiddleware
import os
import json
import io
import httpx
import base64
from datetime import datetime, timezone
from typing import List, Optional
from supabase import create_client, Client
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from PIL import Image

# --- Evolution API CONFIG ---
EVOLUTION_API_URL = os.getenv("EVOLUTION_API_URL")
EVOLUTION_API_KEY = os.getenv("EVOLUTION_API_KEY")
EVOLUTION_API_INSTANCE = os.getenv("EVOLUTION_API_INSTANCE", "servsolda")

async def send_whatsapp_receipt_background(
    phone_number: str,
    nome_cliente: str,
    numero_documento: str,
    cilindros: list,
    fotos: list
):
    if not EVOLUTION_API_URL or not EVOLUTION_API_KEY:
        print("[WHATSAPP] Credenciais da Evolution API não encontradas no .env")
        return

    # Sanitize phone number (remove non-digits)
    raw_phone = "".join(filter(str.isdigit, phone_number))
    if not raw_phone:
        return
    
    # Prepend 55 for Brazil if not present
    if not raw_phone.startswith("55") and len(raw_phone) in (10, 11):
        raw_phone = f"55{raw_phone}"

    print(f"[WHATSAPP] Iniciando envio autônomo para {raw_phone}...")

    # 1. Constrói a mensagem em texto formatado
    items_text = ""
    for c in cilindros:
        obs_val = c.get('obs') or c.get('observacao')
        if obs_val and obs_val.strip() not in ("", "-", "S/N", "obs", "Observação..."):
            obs_text = f" (Obs: {obs_val.strip()})"
        else:
            obs_text = ""
        items_text += f"• *{c.get('qtd', 1)}x {c.get('tipo_gas')} {c.get('tamanho_gas')}*{obs_text}\n"

    # Constrói a mensagem principal em texto
    message = (
        f"*Servsolda - Confirmação de Entrega* 🚚\n\n"
        f"Confirmamos a entrega de gás realizada hoje:\n\n"
        f"🏢 *Cliente:* {nome_cliente or 'Cliente Novo'}\n"
        f"📄 *Nota Fiscal / Documento:* {numero_documento or 'S/N'}\n\n"
        f"📦 *Itens Entregues:*\n{items_text}\n"
        f"Muito obrigado pela parceria!"
    )

    headers = {
        "apikey": EVOLUTION_API_KEY,
        "Content-Type": "application/json"
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        # A. Envia a mensagem de texto principal
        try:
            url_text = f"{EVOLUTION_API_URL.rstrip('/')}/message/sendText/{EVOLUTION_API_INSTANCE}"
            payload_text = {
                "number": raw_phone,
                "options": {
                    "delay": 1200,
                    "presence": "composing"
                },
                "textMessage": {
                    "text": message
                }
            }
            res = await client.post(url_text, headers=headers, json=payload_text)
            print(f"[WHATSAPP] Resposta do envio de texto: {res.status_code} - {res.text}")
        except Exception as e:
            print(f"[WHATSAPP] Erro ao enviar mensagem de texto: {e}")

        # B. Envia as fotos em anexo
        if fotos and len(fotos) > 0:
            for idx, photo_url in enumerate(fotos):
                try:
                    # Extrai o file_id da URL da foto
                    file_id = ""
                    if "/file/d/" in photo_url:
                        parts = photo_url.split("/file/d/")
                        if len(parts) > 1:
                            file_id = parts[1].split("/")[0].split("?")[0]
                    if not file_id and "id=" in photo_url:
                        file_id = photo_url.split("id=")[1].split("&")[0]

                    if not file_id:
                        print(f"[WHATSAPP] N\u00e3o foi poss\u00edvel extrair file_id da URL: {photo_url}")
                        continue

                    # Baixa a imagem do Google Drive
                    print(f"[WHATSAPP] Baixando imagem {file_id} do Drive para envio...")
                    try:
                        drive_service = get_drive_service()
                        request_obj = drive_service.files().get_media(fileId=file_id)
                        image_bytes = request_obj.execute()
                    except Exception as drive_err:
                        print(f"[WHATSAPP] Erro ao baixar imagem {file_id} do Drive: {drive_err}")
                        continue

                    # Comprime em mem\u00f3ria para reduzir o tamanho
                    try:
                        img_buf_in = io.BytesIO(image_bytes)
                        img_buf_out = io.BytesIO()
                        with Image.open(img_buf_in) as img:
                            if img.mode in ("RGBA", "P"):
                                img = img.convert("RGB")
                            img.thumbnail((800, 800), Image.Resampling.LANCZOS)
                            img.save(img_buf_out, format="JPEG", quality=70, optimize=True)
                        image_bytes = img_buf_out.getvalue()
                        print(f"[WHATSAPP] Imagem {file_id} comprimida: {len(image_bytes)} bytes")
                    except Exception as comp_err:
                        print(f"[WHATSAPP] Aviso: n\u00e3o foi poss\u00edvel comprimir imagem {file_id}: {comp_err}")

                    # CORRECAO DEFINITIVA: Evolution API v1.8.7 exige o wrapper 'mediaMessage'
                    # O payload correto usa { mediaMessage: { mediatype, caption, media, ... } }
                    encoded_string = base64.b64encode(image_bytes).decode('utf-8')

                    url_media = f"{EVOLUTION_API_URL.rstrip('/')}/message/sendMedia/{EVOLUTION_API_INSTANCE}"
                    payload_media = {
                        "number": raw_phone,
                        "options": {
                            "delay": 1200,
                            "presence": "composing"
                        },
                        "mediaMessage": {
                            "mediatype": "image",
                            "mimetype": "image/jpeg",
                            "caption": f"Comprovante de Entrega - Foto {idx + 1}",
                            "media": encoded_string,
                            "fileName": f"comprovante_{idx + 1}.jpg"
                        }
                    }
                    res_media = await client.post(url_media, headers=headers, json=payload_media)
                    print(f"[WHATSAPP] Resposta do envio da Foto {idx + 1}: {res_media.status_code} - {res_media.text}")
                except Exception as e:
                    print(f"[WHATSAPP] Erro ao enviar anexo de foto {idx + 1}: {e}")

def compress_image_file(input_path: str, output_path: str, max_size=(1024, 1024), quality=75):
    try:
        with Image.open(input_path) as img:
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            img.thumbnail(max_size, Image.Resampling.LANCZOS)
            img.save(output_path, "JPEG", quality=quality, optimize=True)
            print(f"[COMPRESSÃO] Imagem compactada com sucesso: {input_path} -> {output_path}")
            return True
    except Exception as e:
        print(f"[COMPRESSÃO] Erro ao compactar imagem {input_path}: {e}")
        return False

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
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if SUPABASE_URL and SUPABASE_ANON_KEY:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
else:
    supabase = None

if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
    supabase_admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
else:
    supabase_admin = None

def get_all_supabase_users():
    if not supabase_admin:
        return []
    try:
        res = supabase_admin.auth.admin.list_users()
        if isinstance(res, list):
            return res
        if hasattr(res, "users") and isinstance(res.users, list):
            return res.users
        if hasattr(res, "data") and isinstance(res.data, list):
            return res.data
        return []
    except Exception as e:
        print(f"[SUPABASE ADMIN] Erro ao listar usuários: {e}")
        return []

@app.on_event("startup")
async def startup_event():
    if not supabase_admin:
        print("[SUPABASE ADMIN] Startup sync skipped: supabase_admin not configured.")
        return
    
    db = SessionLocal()
    try:
        print("[SUPABASE ADMIN] Verificando e auto-confirmando usuários locais no Supabase...")
        local_users = db.query(Usuario).all()
        if not local_users:
            print("[SUPABASE ADMIN] Nenhum usuário local para sincronizar.")
            return
            
        users = get_all_supabase_users()
        print(f"[SUPABASE ADMIN] Encontrados {len(users)} usuários no Supabase.")
        
        for local_u in local_users:
            email = local_u.usuario
            # Procura o usuário no Supabase (case-insensitive)
            found_user = None
            for u in users:
                if u.email.lower() == email.lower():
                    found_user = u
                    break
                    
            if found_user:
                # Se existe no Supabase, garante que está confirmado!
                try:
                    supabase_admin.auth.admin.update_user_by_id(found_user.id, {"email_confirm": True})
                    print(f"[SUPABASE ADMIN] Usuário {email} confirmado com sucesso!")
                except Exception as e:
                    print(f"[SUPABASE ADMIN] Erro ao confirmar usuário {email}: {e}")
            else:
                # Se NÃO existe no Supabase (mas existe no banco de dados local com senha em hash),
                # criamos ele com uma senha padrão ('mudar123') para ele conseguir logar ou resetar pelo painel.
                try:
                    new_user = supabase_admin.auth.admin.create_user({
                        "email": email,
                        "password": "mudar123",
                        "email_confirm": True
                    })
                    print(f"[SUPABASE ADMIN] Usuário {email} criado com sucesso com senha padrão 'mudar123'!")
                except Exception as e:
                    print(f"[SUPABASE ADMIN] Erro ao criar usuário {email} no Supabase: {e}")
    except Exception as err:
        print(f"[SUPABASE ADMIN] Erro geral na migração de inicialização: {err}")
    finally:
        db.close()


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

@app.get("/api/proxy-image/{file_id}")
async def proxy_image(file_id: str):
    cache_dir = "temp/cache"
    os.makedirs(cache_dir, exist_ok=True)
    cache_path = os.path.join(cache_dir, f"{file_id}.jpg")
    
    if os.path.exists(cache_path):
        print(f"[RASTREIO] Imagem {file_id} recuperada instantaneamente do cache local!")
        return FileResponse(cache_path, media_type="image/jpeg")
        
    try:
        print(f"[RASTREIO] Baixando imagem {file_id} do Google Drive...")
        service = get_drive_service()
        request = service.files().get_media(fileId=file_id)
        file_bytes = request.execute()
        
        temp_original_path = os.path.join(cache_dir, f"temp_{file_id}.jpg")
        with open(temp_original_path, "wb") as f:
            f.write(file_bytes)
            
        success = compress_image_file(temp_original_path, cache_path)
        
        if os.path.exists(temp_original_path):
            os.remove(temp_original_path)
            
        if success and os.path.exists(cache_path):
            print(f"[RASTREIO] Imagem {file_id} compactada e salva no cache local.")
            return FileResponse(cache_path, media_type="image/jpeg")
        else:
            with open(cache_path, "wb") as f:
                f.write(file_bytes)
            return StreamingResponse(io.BytesIO(file_bytes), media_type="image/jpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao recuperar imagem do Drive: {str(e)}")

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

# --- USER CRUD (ADMIN ONLY) ---

@app.get("/api/admin/usuarios")
async def list_usuarios(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("nivel_acesso") != "adm":
        raise HTTPException(status_code=403, detail="Acesso negado")
    usuarios = db.query(Usuario).all()
    return [{"id": u.id, "nome": u.nome, "usuario": u.usuario, "nivel_acesso": u.nivel_acesso} for u in usuarios]

@app.post("/api/admin/usuarios")
async def create_usuario(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("nivel_acesso") != "adm":
        raise HTTPException(status_code=403, detail="Acesso negado")
        
    nome = payload.get("nome")
    email = payload.get("usuario")
    senha = payload.get("senha")
    nivel = payload.get("nivel_acesso", "usuario")
    
    if not nome or not email or not senha:
        raise HTTPException(status_code=400, detail="Nome, e-mail e senha são obrigatórios")
        
    existing = db.query(Usuario).filter(Usuario.usuario == email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Usuário já cadastrado com este e-mail")
        
    # Tenta cadastrar no Supabase Auth se o admin client estiver disponível
    if supabase_admin:
        try:
            print(f"[SUPABASE ADMIN] Verificando existência de {email} no Supabase...")
            users = get_all_supabase_users()
            supabase_user = None
            for u in users:
                if u.email.lower() == email.lower():
                    supabase_user = u
                    break
            
            if not supabase_user:
                print(f"[SUPABASE ADMIN] Criando usuário {email} no Supabase...")
                supabase_admin.auth.admin.create_user({
                    "email": email,
                    "password": senha,
                    "email_confirm": True
                })
                print(f"[SUPABASE ADMIN] Usuário {email} criado e confirmado no Supabase.")
            else:
                print(f"[SUPABASE ADMIN] Usuário {email} já existia no Supabase. Atualizando senha...")
                supabase_admin.auth.admin.update_user_by_id(
                    supabase_user.id,
                    {"password": senha, "email_confirm": True}
                )
        except Exception as sb_err:
            print(f"[SUPABASE ADMIN] Erro ao sincronizar com Supabase: {sb_err}")
            # Não falha o cadastro local, mas registra o log
            
    import hashlib
    senha_hash = hashlib.sha256(senha.encode()).hexdigest()
    
    novo_usuario = Usuario(
        nome=nome,
        usuario=email,
        senha_hash=senha_hash,
        nivel_acesso=nivel
    )
    db.add(novo_usuario)
    db.commit()
    db.refresh(novo_usuario)
    return {"status": "success", "id": novo_usuario.id}

@app.put("/api/admin/usuarios/{user_id}")
async def update_usuario(
    user_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("nivel_acesso") != "adm":
        raise HTTPException(status_code=403, detail="Acesso negado")
        
    usuario_db = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not usuario_db:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
        
    nome = payload.get("nome")
    email = payload.get("usuario")
    senha = payload.get("senha")
    nivel = payload.get("nivel_acesso")
    
    if nome:
        usuario_db.nome = nome
    if email:
        usuario_db.usuario = email
    if nivel:
        usuario_db.nivel_acesso = nivel
        
    if senha:
        import hashlib
        usuario_db.senha_hash = hashlib.sha256(senha.encode()).hexdigest()
        
        # Sincroniza a nova senha com o Supabase Auth
        if supabase_admin:
            try:
                print(f"[SUPABASE ADMIN] Atualizando senha do usuário {usuario_db.usuario} no Supabase...")
                users = get_all_supabase_users()
                for u in users:
                    if u.email.lower() == usuario_db.usuario.lower():
                        supabase_admin.auth.admin.update_user_by_id(
                            u.id,
                            {"password": senha, "email_confirm": True}
                        )
                        print(f"[SUPABASE ADMIN] Senha do usuário {usuario_db.usuario} atualizada no Supabase com sucesso.")
                        break
            except Exception as sb_err:
                print(f"[SUPABASE ADMIN] Erro ao sincronizar nova senha com Supabase: {sb_err}")
        
    db.commit()
    return {"status": "success"}

@app.delete("/api/admin/usuarios/{user_id}")
async def delete_usuario(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("nivel_acesso") != "adm":
        raise HTTPException(status_code=403, detail="Acesso negado")
        
    usuario_db = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not usuario_db:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
        
    # Deleta o usuário do Supabase Auth
    if supabase_admin:
        try:
            print(f"[SUPABASE ADMIN] Removendo usuário {usuario_db.usuario} do Supabase...")
            users = get_all_supabase_users()
            for u in users:
                if u.email.lower() == usuario_db.usuario.lower():
                    supabase_admin.auth.admin.delete_user(u.id)
                    print(f"[SUPABASE ADMIN] Usuário {usuario_db.usuario} removido do Supabase com sucesso.")
                    break
        except Exception as sb_err:
            print(f"[SUPABASE ADMIN] Erro ao remover usuário do Supabase: {sb_err}")
            
    db.delete(usuario_db)
    db.commit()
    return {"status": "success"}




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
    payload: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    print(f"\n--- [RASTREIO] NOVA REQUISIÇÃO RECEBIDA (JSON) ---")
    cnpj = payload.get('cnpj')
    nome_cliente = payload.get('nome_cliente', 'Cliente Novo')
    numero_documento = payload.get('numero_documento')
    data_entrega_str = payload.get('data_entrega')
    tipo_entrega = payload.get('tipo_entrega')
    cilindros_data = payload.get('cilindros', [])
    fotos_pre_carregadas = payload.get('fotos_pre_carregadas', [])
    whatsapp_phone = payload.get('whatsapp_phone')

    cliente = db.query(Cliente).filter(Cliente.cnpj == cnpj).first()
    if not cliente:
        cliente = Cliente(cnpj=cnpj, nome_razao=nome_cliente, lat=payload.get('lat'), lng=payload.get('lng'))
        db.add(cliente)
        db.commit()
        db.refresh(cliente)
    else:
        if payload.get('lat'):
            cliente.lat = payload.get('lat')
            cliente.lng = payload.get('lng')
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
        lat=payload.get('lat'),
        lng=payload.get('lng')
    )
    db.add(entrega)
    db.commit()
    db.refresh(entrega)
    print(f"[RASTREIO] Entrega {entrega.id} | Cliente: {nome_cliente} | CNPJ: {cnpj}")

    if fotos_pre_carregadas:
        entrega.fotos_urls = ",".join(fotos_pre_carregadas)
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

    if whatsapp_phone:
        print(f"[WHATSAPP] Agendando tarefa de envio em segundo plano para {whatsapp_phone}...")
        background_tasks.add_task(
            send_whatsapp_receipt_background,
            whatsapp_phone,
            nome_cliente,
            numero_documento,
            cilindros_data,
            fotos_pre_carregadas
        )

    return {"status": "success", "id": entrega.id, "photos": fotos_pre_carregadas}

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
            (Entrega.numero_documento.ilike(f"%{search}%")) |
            Entrega.cilindros.any(CilindroAplicado.data_validade.ilike(f"%{search}%")) |
            Entrega.cilindros.any(CilindroAplicado.observacao.ilike(f"%{search}%"))
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
            "data": e.data_entrega.strftime("%Y-%m-%dT%H:%M:%S") if e.data_entrega else None,
            "nf": e.numero_documento or "S/N",
            "cliente": nome,
            "fotos": e.fotos_urls.split(",") if e.fotos_urls else [],
            "itens": [{"gas": i.tipo_gas, "tam": i.tamanho_gas, "qtd": i.quantidade, "validade": i.data_validade, "obs": i.observacao} for i in e.cilindros]
        })
    return result

@app.get("/api/deletar_entrega/{id}")
async def deletar_entrega(id: int, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    if current_user.get("nivel_acesso") != "adm":
        raise HTTPException(status_code=403, detail="Acesso negado")
    entrega = db.query(Entrega).filter(Entrega.id == id).first()
    if not entrega:
        raise HTTPException(status_code=404, detail="Entrega não encontrada")
    db.delete(entrega)
    db.commit()
    return {"status": "deleted"}

@app.post("/api/entregas/{id}/reenviar-whatsapp")
async def reenviar_whatsapp(
    id: int, 
    payload: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    whatsapp_phone = payload.get("whatsapp_phone")
    if not whatsapp_phone:
        raise HTTPException(status_code=400, detail="Número de WhatsApp não fornecido")

    entrega = db.query(Entrega).filter(Entrega.id == id).first()
    if not entrega:
        raise HTTPException(status_code=404, detail="Entrega não encontrada")

    nome = "Cliente Desconhecido"
    if entrega.cliente:
        nome = entrega.cliente.nome_razao
    elif entrega.nome_cliente:
        nome = entrega.nome_cliente

    cilindros_data = [
        {
            "tipo_gas": cil.tipo_gas,
            "tamanho_gas": cil.tamanho_gas,
            "qtd": cil.quantidade,
            "obs": cil.observacao
        }
        for cil in entrega.cilindros
    ]

    fotos_pre_carregadas = entrega.fotos_urls.split(",") if entrega.fotos_urls else []

    background_tasks.add_task(
        send_whatsapp_receipt_background,
        whatsapp_phone,
        nome,
        entrega.numero_documento,
        cilindros_data,
        fotos_pre_carregadas
    )

    return {"status": "success", "message": "Reenvio agendado"}

@app.delete("/api/clientes/{cnpj}")
async def delete_cliente(cnpj: str, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    if current_user.get("nivel_acesso") != "adm":
        raise HTTPException(status_code=403, detail="Acesso negado")
    cliente = db.query(Cliente).filter(Cliente.cnpj == cnpj).first()
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    
    # Limpa referências de entrega para este cliente
    db.query(Entrega).filter(Entrega.fk_cliente == cnpj).update({Entrega.fk_cliente: None})
    
    db.delete(cliente)
    db.commit()
    return {"status": "deleted"}

@app.get("/api/admin/google-drive-config")
async def get_google_drive_config(current_user: dict = Depends(get_current_user)):
    if current_user.get("nivel_acesso") != "adm":
        raise HTTPException(status_code=403, detail="Acesso negado")
    
    config = get_google_config()
    return {
        "GOOGLE_CLIENT_ID": config.get("GOOGLE_CLIENT_ID", ""),
        "GOOGLE_CLIENT_SECRET": config.get("GOOGLE_CLIENT_SECRET", ""),
        "GOOGLE_REFRESH_TOKEN": config.get("GOOGLE_REFRESH_TOKEN", ""),
        "DRIVE_ROOT_FOLDER_ID": config.get("DRIVE_ROOT_FOLDER_ID", ""),
        "USE_SERVICE_ACCOUNT": config.get("USE_SERVICE_ACCOUNT", False)
    }

@app.post("/api/admin/google-drive-config")
async def save_google_drive_config(payload: dict, current_user: dict = Depends(get_current_user)):
    if current_user.get("nivel_acesso") != "adm":
        raise HTTPException(status_code=403, detail="Acesso negado")
    
    config_data = {
        "GOOGLE_CLIENT_ID": payload.get("GOOGLE_CLIENT_ID", "").strip(),
        "GOOGLE_CLIENT_SECRET": payload.get("GOOGLE_CLIENT_SECRET", "").strip(),
        "GOOGLE_REFRESH_TOKEN": payload.get("GOOGLE_REFRESH_TOKEN", "").strip(),
        "DRIVE_ROOT_FOLDER_ID": payload.get("DRIVE_ROOT_FOLDER_ID", "").strip(),
        "USE_SERVICE_ACCOUNT": bool(payload.get("USE_SERVICE_ACCOUNT", False))
    }
    
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config_data, f, indent=4)
        return {"status": "success", "message": "Configurações salvas com sucesso!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao salvar configurações: {str(e)}")

@app.post("/api/admin/google-drive-config/test")
async def test_google_drive_config(payload: dict, current_user: dict = Depends(get_current_user)):
    if current_user.get("nivel_acesso") != "adm":
        raise HTTPException(status_code=403, detail="Acesso negado")
    
    config_data = {
        "GOOGLE_CLIENT_ID": payload.get("GOOGLE_CLIENT_ID", "").strip(),
        "GOOGLE_CLIENT_SECRET": payload.get("GOOGLE_CLIENT_SECRET", "").strip(),
        "GOOGLE_REFRESH_TOKEN": payload.get("GOOGLE_REFRESH_TOKEN", "").strip(),
        "DRIVE_ROOT_FOLDER_ID": payload.get("DRIVE_ROOT_FOLDER_ID", "").strip(),
        "USE_SERVICE_ACCOUNT": bool(payload.get("USE_SERVICE_ACCOUNT", False))
    }
    
    try:
        service = get_drive_service(custom_config=config_data)
        root_id = config_data.get("DRIVE_ROOT_FOLDER_ID")
        if not root_id:
            return {"status": "error", "message": "ID da pasta raiz do Drive não foi fornecido"}
            
        results = service.files().list(q=f"'{root_id}' in parents and trashed = false", pageSize=1, fields="files(id, name)").execute()
        return {"status": "success", "message": "Conexão com Google Drive realizada com sucesso! Pasta raiz encontrada."}
    except Exception as e:
        err_msg = str(e)
        if "service-account.json" in err_msg or "FileNotFoundError" in err_msg:
            err_msg = "Arquivo service-account.json não encontrado no servidor."
        elif "invalid_grant" in err_msg or "expired or revoked" in err_msg:
            err_msg = "Token expirado ou revogado. Por favor, gere um novo refresh token."
        elif "client_id" in err_msg or "client_secret" in err_msg:
            err_msg = "Client ID ou Client Secret incorretos."
@app.get("/api/admin/google-drive-status")
async def get_google_drive_status(current_user: dict = Depends(get_current_user)):
    if current_user.get("nivel_acesso") != "adm":
        raise HTTPException(status_code=403, detail="Acesso negado")
    
    try:
        config = get_google_config()
        service = get_drive_service()
        root_id = config.get("DRIVE_ROOT_FOLDER_ID")
        if not root_id:
            return {"status": "error", "message": "ID da pasta raiz não configurado"}
        
        service.files().list(q=f"'{root_id}' in parents and trashed = false", pageSize=1, fields="files(id)").execute()
        return {"status": "success"}
    except Exception as e:
        err_msg = str(e)
        if "service-account.json" in err_msg or "FileNotFoundError" in err_msg:
            err_msg = "Arquivo service-account.json não encontrado."
        elif "invalid_grant" in err_msg or "expired or revoked" in err_msg:
            err_msg = "Token expirado ou revogado."
        elif "client_id" in err_msg or "client_secret" in err_msg:
            err_msg = "Client ID ou Client Secret incorretos."
        return {"status": "error", "message": err_msg}

@app.post("/api/upload-temp-photo")
async def upload_temp_photo(
    foto: UploadFile = File(...),
    client_name: Optional[str] = Form("Temp"),
    invoice_number: Optional[str] = Form("Temp"),
    current_user: dict = Depends(get_current_user)
):
    os.makedirs("temp", exist_ok=True)
    content = await foto.read()
    raw_file_path = os.path.join("temp", f"raw_{foto.filename}")
    with open(raw_file_path, "wb") as f:
        f.write(content)
        
    file_path = os.path.join("temp", f"temp_upload_{foto.filename}")
    success = compress_image_file(raw_file_path, file_path)
    
    if not success or not os.path.exists(file_path):
        if os.path.exists(file_path):
            os.remove(file_path)
        os.rename(raw_file_path, file_path)
    else:
        if os.path.exists(raw_file_path):
            os.remove(raw_file_path)
        
    try:
        res = upload_temp_file_to_drive(file_path, client_name, invoice_number)
        return {"drive_url": res["url"], "file_id": res["file_id"]}
    except Exception as e:
        err_msg = str(e)
        if "invalid_grant" in err_msg or "expired or revoked" in err_msg:
            err_msg = "Token expirado ou revogado no Google Drive. Verifique as configurações."
        raise HTTPException(status_code=500, detail=f"Erro ao enviar para o Drive: {err_msg}")
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)

@app.delete("/api/delete-temp-photo/{file_id}")
async def delete_temp_photo(file_id: str, current_user: dict = Depends(get_current_user)):
    success = delete_file_from_drive(file_id)
    if success:
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Erro ao deletar do Google Drive")

@app.get("/api/whatsapp/status")
async def get_whatsapp_status(current_user: dict = Depends(get_current_user)):
    if not EVOLUTION_API_URL or not EVOLUTION_API_KEY:
        return {"status": "error", "message": "Evolution API não configurada no .env"}
    
    headers = {"apikey": EVOLUTION_API_KEY}
    url = f"{EVOLUTION_API_URL.rstrip('/')}/instance/connectionState/{EVOLUTION_API_INSTANCE}"
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            r = await client.get(url, headers=headers)
            if r.status_code == 200:
                data = r.json()
                instance_data = data.get("instance", {})
                state = instance_data.get("state")
                return {"status": "success", "state": state, "data": data}
            else:
                return {"status": "error", "message": f"Erro na API: {r.status_code}", "detail": r.text}
        except Exception as e:
            return {"status": "error", "message": f"Falha de conexão: {str(e)}"}

@app.get("/api/whatsapp/qr")
async def get_whatsapp_qr(current_user: dict = Depends(get_current_user)):
    if not EVOLUTION_API_URL or not EVOLUTION_API_KEY:
        return {"status": "error", "message": "Evolution API não configurada no .env"}
    
    headers = {"apikey": EVOLUTION_API_KEY}
    
    async with httpx.AsyncClient(timeout=20.0) as client:
        try:
            # 1. Tenta garantir que a instância existe
            url_create = f"{EVOLUTION_API_URL.rstrip('/')}/instance/create"
            payload_create = {
                "instanceName": EVOLUTION_API_INSTANCE,
                "token": "42a24fa6-403d-4c7b-b30a-9359e9a4f783",
                "qrcode": True
            }
            await client.post(url_create, headers=headers, json=payload_create)
            
            # 2. Busca o QR Code de conexão
            url_connect = f"{EVOLUTION_API_URL.rstrip('/')}/instance/connect/{EVOLUTION_API_INSTANCE}"
            r = await client.get(url_connect, headers=headers)
            if r.status_code == 200:
                data = r.json()
                qr_base64 = data.get('base64') or data.get('qrcode', {}).get('base64')
                return {"status": "success", "base64": qr_base64, "data": data}
            else:
                return {"status": "error", "message": f"Erro ao conectar: {r.status_code}", "detail": r.text}
        except Exception as e:
            return {"status": "error", "message": f"Falha de conexão: {str(e)}"}

@app.post("/api/whatsapp/disconnect")
async def disconnect_whatsapp(current_user: dict = Depends(get_current_user)):
    if not EVOLUTION_API_URL or not EVOLUTION_API_KEY:
        return {"status": "error", "message": "Evolution API não configurada no .env"}
        
    headers = {"apikey": EVOLUTION_API_KEY}
    url = f"{EVOLUTION_API_URL.rstrip('/')}/instance/logout/{EVOLUTION_API_INSTANCE}"
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            r = await client.post(url, headers=headers)
            return {"status": "success", "detail": r.text}
        except Exception as e:
            return {"status": "error", "message": str(e)}

# --- STATIC FILES ---
app.mount("/assets", StaticFiles(directory="assets"), name="assets")
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
