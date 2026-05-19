import os
from storage import get_drive_service

def fix_all_permissions():
    print("Iniciando correção de permissões no Google Drive...")
    try:
        service = get_drive_service()
        query = "mimeType != 'application/vnd.google-apps.folder' and trashed = false"
        print("Buscando arquivos...")
        results = service.files().list(q=query, fields="nextPageToken, files(id, name)", pageSize=1000).execute()
        files = results.get('files', [])
        
        print(f"Encontrados {len(files)} arquivos.")
        count = 0
        for file in files:
            file_id = file.get('id')
            file_name = file.get('name')
            print(f"Aplicando permissão pública em: {file_name} ({file_id})")
            try:
                service.permissions().create(
                    fileId=file_id,
                    body={'type': 'anyone', 'role': 'reader'}
                ).execute()
                count += 1
            except Exception as e:
                print(f"Erro no arquivo {file_name}: {e}")
                
        print(f"\nConcluído! {count} arquivos atualizados para visualização pública.")
    except Exception as e:
        print(f"Erro geral: {e}")

if __name__ == '__main__':
    fix_all_permissions()
