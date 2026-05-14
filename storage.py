import os
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from datetime import datetime

# Path to your Service Account JSON file
SERVICE_ACCOUNT_FILE = os.getenv('GOOGLE_APPLICATION_CREDENTIALS', 'service-account.json')
SCOPES = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive']

# Root folder ID where everything will be saved. 
# Get this from the folder URL in Google Drive
DRIVE_ROOT_FOLDER_ID = os.getenv('DRIVE_ROOT_FOLDER_ID')

def get_drive_service():
    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        raise FileNotFoundError(f"Arquivo de credenciais não encontrado: {SERVICE_ACCOUNT_FILE}")
    
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    return build('drive', 'v3', credentials=creds)

def find_or_create_folder(service, folder_name, parent_id):
    query = f"name = '{folder_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '{parent_id}' in parents"
    
    results = service.files().list(q=query, fields="files(id)").execute()
    files = results.get('files', [])
    
    if files:
        return files[0]['id']
    else:
        file_metadata = {
            'name': folder_name,
            'mimeType': 'application/vnd.google-apps.folder',
            'parents': [parent_id]
        }
        folder = service.files().create(body=file_metadata, fields='id').execute()
        return folder.get('id')

def upload_file_to_drive(file_path, client_name, invoice_number, date_obj=None):
    if not DRIVE_ROOT_FOLDER_ID:
        raise ValueError("DRIVE_ROOT_FOLDER_ID não configurado no ambiente (.env)")
        
    service = get_drive_service()
    
    # Structure: {Root} > {cliente} > {ano} > {mes} > {nota}
    now = date_obj or datetime.now()
    year = str(now.year)
    month = now.strftime('%m')
    
    # Navigation through folders
    client_folder_id = find_or_create_folder(service, client_name, DRIVE_ROOT_FOLDER_ID)
    year_folder_id = find_or_create_folder(service, year, client_folder_id)
    month_folder_id = find_or_create_folder(service, month, year_folder_id)
    invoice_folder_id = find_or_create_folder(service, f"Nota_{invoice_number}", month_folder_id)
    
    file_metadata = {
        'name': os.path.basename(file_path),
        'parents': [invoice_folder_id]
    }
    
    # Mime type for images (or auto-detect)
    media = MediaFileUpload(file_path, resumable=True)
    
    file = service.files().create(
        body=file_metadata,
        media_body=media,
        fields='id, webViewLink, webContentLink'
    ).execute()
    
    # Return webContentLink for direct download/view if possible, 
    # or webViewLink for the standard Drive viewer
    return file.get('webContentLink') or file.get('webViewLink')
