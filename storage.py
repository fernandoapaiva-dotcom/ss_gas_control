import os
import json
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from datetime import datetime

# Config path
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'google_config.json')

def get_google_config():
    config = {
        'GOOGLE_CLIENT_ID': os.getenv('GOOGLE_CLIENT_ID') or '',
        'GOOGLE_CLIENT_SECRET': os.getenv('GOOGLE_CLIENT_SECRET') or '',
        'GOOGLE_REFRESH_TOKEN': os.getenv('GOOGLE_REFRESH_TOKEN') or '',
        'DRIVE_ROOT_FOLDER_ID': os.getenv('DRIVE_ROOT_FOLDER_ID') or ''
    }
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for k in config.keys():
                    val = data.get(k) or data.get(k.replace('GOOGLE_', ''))
                    if val:
                        config[k] = val
        except Exception as e:
            print(f"[CONFIG] Erro ao ler google_config.json: {e}")
    return config

_google_creds = None

def get_drive_service(custom_config=None):
    global _google_creds
    print(f"[RASTREIO] Iniciando get_drive_service...")
    
    config = custom_config or get_google_config()
    client_id = config.get('GOOGLE_CLIENT_ID')
    client_secret = config.get('GOOGLE_CLIENT_SECRET')
    refresh_token = config.get('GOOGLE_REFRESH_TOKEN')
    
    if not all([client_id, client_secret, refresh_token]):
        missing = [k for k, v in {"GOOGLE_CLIENT_ID": client_id, "GOOGLE_CLIENT_SECRET": client_secret, "GOOGLE_REFRESH_TOKEN": refresh_token}.items() if not v]
        print(f"[RASTREIO] ERRO: Faltam configurações: {missing}")
        raise ValueError(f"Faltam configurações do Google: {', '.join(missing)}")

    # Se for uma configuração de teste temporária, não cacheamos globalmente
    if custom_config:
        print(f"[RASTREIO] Usando credenciais customizadas para teste...")
        creds = Credentials(
            None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
        )
        creds.refresh(Request())
        return build('drive', 'v3', credentials=creds)

    # Caso contrário, usa/atualiza o cache global
    if _google_creds is None or \
       _google_creds.client_id != client_id or \
       _google_creds.client_secret != client_secret or \
       _google_creds.refresh_token != refresh_token:
        print(f"[RASTREIO] Inicializando/Atualizando credenciais do Google Drive...")
        _google_creds = Credentials(
            None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
        )
    
    if not _google_creds.valid:
        print(f"[RASTREIO] Token expirado, tentando dar refresh...")
        try:
            _google_creds.refresh(Request())
            print(f"[RASTREIO] Refresh feito com sucesso!")
        except Exception as e:
            print(f"[RASTREIO] ERRO ao dar refresh: {str(e)}")
            raise e
        
    return build('drive', 'v3', credentials=_google_creds)

def find_or_create_folder(service, folder_name, parent_id):
    print(f"[RASTREIO] Procurando pasta '{folder_name}' dentro de '{parent_id}'...")
    query = f"name = '{folder_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '{parent_id}' in parents"
    results = service.files().list(q=query, fields="files(id)").execute()
    files = results.get('files', [])
    
    if files:
        print(f"[RASTREIO] Pasta '{folder_name}' já existe: {files[0]['id']}")
        return files[0]['id']
    else:
        print(f"[RASTREIO] Criando nova pasta '{folder_name}'...")
        file_metadata = {
            'name': folder_name,
            'mimeType': 'application/vnd.google-apps.folder',
            'parents': [parent_id]
        }
        folder = service.files().create(body=file_metadata, fields='id').execute()
        print(f"[RASTREIO] Pasta '{folder_name}' criada com ID: {folder.get('id')}")
        return folder.get('id')

def upload_file_to_drive(file_path, client_name, invoice_number, date_obj=None):
    print(f"--- INICIANDO RASTREIO DE UPLOAD ---")
    print(f"[RASTREIO] Arquivo: {file_path}")
    print(f"[RASTREIO] Cliente: {client_name}, Nota: {invoice_number}")
    
    config = get_google_config()
    root_folder_id = config.get('DRIVE_ROOT_FOLDER_ID')
    if not root_folder_id:
        print(f"[RASTREIO] ERRO: DRIVE_ROOT_FOLDER_ID não configurado!")
        raise ValueError("DRIVE_ROOT_FOLDER_ID não configurado")
        
    try:
        service = get_drive_service()
        
        # Structure: {Root} > {cliente} > {ano} > {mes} > {nota}
        now = date_obj or datetime.now()
        year = str(now.year)
        month = now.strftime('%m')
        
        print(f"[RASTREIO] Resolvendo estrutura de pastas...")
        client_folder_id = find_or_create_folder(service, client_name, root_folder_id)
        year_folder_id = find_or_create_folder(service, year, client_folder_id)
        month_folder_id = find_or_create_folder(service, month, year_folder_id)
        invoice_folder_id = find_or_create_folder(service, f"Nota_{invoice_number}", month_folder_id)
        
        print(f"[RASTREIO] Preparando upload do arquivo...")
        file_metadata = {
            'name': os.path.basename(file_path),
            'parents': [invoice_folder_id]
        }
        
        media = MediaFileUpload(file_path, resumable=True)
        
        print(f"[RASTREIO] Enviando para o Google Drive...")
        file = service.files().create(
            body=file_metadata,
            media_body=media,
            fields='id, webViewLink, webContentLink'
        ).execute()
        
        print(f"[RASTREIO] UPLOAD CONCLUÍDO! ID: {file.get('id')}")
        
        # Define a permissão do arquivo como pública ("anyone with the link can view") para evitar telas de solicitação de acesso
        try:
            print(f"[RASTREIO] Tornando o arquivo acessível por link público...")
            service.permissions().create(
                fileId=file.get('id'),
                body={'type': 'anyone', 'role': 'reader'}
            ).execute()
            print(f"[RASTREIO] Permissão pública aplicada com sucesso!")
        except Exception as perm_err:
            print(f"[RASTREIO] Erro não fatal ao aplicar permissão pública: {str(perm_err)}")
            
        return file.get('webContentLink') or file.get('webViewLink')
        
    except Exception as e:
        print(f"[RASTREIO] !!! ERRO FATAL NO UPLOAD !!!")
        print(f"[RASTREIO] Detalhes do erro: {str(e)}")
        raise e

def upload_temp_file_to_drive(file_path, client_name="Temp", invoice_number="Temp"):
    print(f"[RASTREIO] Iniciando upload temporário: {file_path}")
    config = get_google_config()
    root_folder_id = config.get('DRIVE_ROOT_FOLDER_ID')
    if not root_folder_id:
        raise ValueError("DRIVE_ROOT_FOLDER_ID não configurado")
    service = get_drive_service()
    try:
        client_folder_id = find_or_create_folder(service, client_name, root_folder_id)
        invoice_folder_id = find_or_create_folder(service, f"Nota_{invoice_number}", client_folder_id)
        
        file_metadata = {
            'name': os.path.basename(file_path),
            'parents': [invoice_folder_id]
        }
        media = MediaFileUpload(file_path, resumable=True)
        file = service.files().create(
            body=file_metadata,
            media_body=media,
            fields='id, webViewLink, webContentLink'
        ).execute()
        
        file_id = file.get('id')
        try:
            service.permissions().create(
                fileId=file_id,
                body={'type': 'anyone', 'role': 'reader'}
            ).execute()
        except: pass
        
        url = file.get('webContentLink') or file.get('webViewLink')
        return {"url": url, "file_id": file_id}
    except Exception as e:
        print(f"[RASTREIO] Erro upload temporário: {str(e)}")
        raise e

def delete_file_from_drive(file_id):
    print(f"[RASTREIO] Deletando arquivo {file_id} do Google Drive...")
    try:
        service = get_drive_service()
        service.files().delete(fileId=file_id).execute()
        print(f"[RASTREIO] Arquivo {file_id} deletado com sucesso!")
        return True
    except Exception as e:
        print(f"[RASTREIO] Erro ao deletar arquivo {file_id}: {str(e)}")
        return False
