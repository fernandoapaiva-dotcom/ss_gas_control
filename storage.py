import os
import json
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from datetime import datetime

# Google OAuth2 Credentials
CLIENT_ID = os.getenv('GOOGLE_CLIENT_ID')
CLIENT_SECRET = os.getenv('GOOGLE_CLIENT_SECRET')
REFRESH_TOKEN = os.getenv('GOOGLE_REFRESH_TOKEN')
DRIVE_ROOT_FOLDER_ID = os.getenv('DRIVE_ROOT_FOLDER_ID')

def get_drive_service():
    print(f"[RASTREIO] Iniciando get_drive_service...")
    if not all([CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN]):
        missing = [k for k, v in {"CLIENT_ID": CLIENT_ID, "CLIENT_SECRET": CLIENT_SECRET, "REFRESH_TOKEN": REFRESH_TOKEN}.items() if not v]
        print(f"[RASTREIO] ERRO: Faltam configurações: {missing}")
        raise ValueError(f"Faltam configurações do Google no .env: {', '.join(missing)}")

    creds = Credentials(
        None,
        refresh_token=REFRESH_TOKEN,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
    )
    
    if not creds.valid:
        print(f"[RASTREIO] Token expirado, tentando dar refresh...")
        try:
            creds.refresh(Request())
            print(f"[RASTREIO] Refresh feito com sucesso!")
        except Exception as e:
            print(f"[RASTREIO] ERRO ao dar refresh: {str(e)}")
            raise e
        
    return build('drive', 'v3', credentials=creds)

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
    
    if not DRIVE_ROOT_FOLDER_ID:
        print(f"[RASTREIO] ERRO: DRIVE_ROOT_FOLDER_ID não configurado!")
        raise ValueError("DRIVE_ROOT_FOLDER_ID não configurado no ambiente (.env)")
        
    try:
        service = get_drive_service()
        
        # Structure: {Root} > {cliente} > {ano} > {mes} > {nota}
        now = date_obj or datetime.now()
        year = str(now.year)
        month = now.strftime('%m')
        
        print(f"[RASTREIO] Resolvendo estrutura de pastas...")
        client_folder_id = find_or_create_folder(service, client_name, DRIVE_ROOT_FOLDER_ID)
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
