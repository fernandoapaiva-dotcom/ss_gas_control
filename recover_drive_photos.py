"""
Script para recuperar e associar as URLs de fotos já existentes no Google Drive
aos registros correspondentes no banco de dados SQLite.
"""
import os
import sqlite3
from datetime import datetime
from storage import get_drive_service, DRIVE_ROOT_FOLDER_ID

DB_PATH = "/home/ubuntu/ss_gas_control/test.db" if os.path.exists("/home/ubuntu/ss_gas_control/test.db") else "test.db"

def find_folder(service, folder_name, parent_id):
    query = f"name = '{folder_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '{parent_id}' in parents"
    results = service.files().list(q=query, fields="files(id)").execute()
    files = results.get('files', [])
    if files:
        return files[0]['id']
    return None

def list_files_in_folder(service, folder_id):
    query = f"'{folder_id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'"
    results = service.files().list(q=query, fields="files(id, webViewLink, webContentLink)").execute()
    return results.get('files', [])

def recover_photos():
    print("Iniciando recuperação de fotos do Google Drive...")
    
    try:
        service = get_drive_service()
    except Exception as e:
        print(f"Erro ao conectar com Google Drive: {e}")
        return

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    cur.execute("SELECT id, numero_documento, nome_cliente, data_entrega, fotos_urls FROM entregas")
    deliveries = cur.fetchall()
    
    updated_count = 0
    
    for row in deliveries:
        d_id, nf, client_name, data_entrega_str, existing_urls = row
        
        # Se já tem fotos e não está vazio, pula
        if existing_urls and existing_urls.strip():
            print(f"Entrega {d_id} já possui fotos cadastradas.")
            continue
            
        print(f"\nBuscando fotos para Entrega {d_id} | Cliente: {client_name} | NF: {nf}...")
        
        if not client_name or not nf:
            print("Dados insuficientes para buscar no Drive.")
            continue
            
        try:
            # Parse data
            if ' ' in data_entrega_str:
                dt = datetime.strptime(data_entrega_str.split('.')[0], "%Y-%m-%d %H:%M:%S")
            else:
                dt = datetime.fromisoformat(data_entrega_str.replace('Z', '+00:00'))
            
            year = str(dt.year)
            month = dt.strftime('%m')
        except Exception as e:
            print(f"Erro ao parsear data '{data_entrega_str}': {e}")
            dt = datetime.now()
            year = str(dt.year)
            month = dt.strftime('%m')

        # Navega na estrutura: Root > Client > Year > Month > Nota_{NF}
        client_folder_id = find_folder(service, client_name, DRIVE_ROOT_FOLDER_ID)
        if not client_folder_id:
            print(f"Pasta do cliente '{client_name}' não encontrada.")
            continue
            
        year_folder_id = find_folder(service, year, client_folder_id)
        if not year_folder_id:
            print(f"Pasta do ano '{year}' não encontrada.")
            continue
            
        month_folder_id = find_folder(service, month, year_folder_id)
        if not month_folder_id:
            print(f"Pasta do mês '{month}' não encontrada.")
            continue
            
        invoice_folder_id = find_folder(service, f"Nota_{nf}", month_folder_id)
        if not invoice_folder_id:
            print(f"Pasta 'Nota_{nf}' não encontrada.")
            continue
            
        # Lista os arquivos dentro da pasta
        files = list_files_in_folder(service, invoice_folder_id)
        if not files:
            print(f"Nenhuma foto encontrada na pasta 'Nota_{nf}'.")
            continue
            
        urls = [f.get('webContentLink') or f.get('webViewLink') for f in files]
        urls_str = ",".join(urls)
        
        # Atualiza no banco
        cur.execute("UPDATE entregas SET fotos_urls = ? WHERE id = ?", (urls_str, d_id))
        conn.commit()
        print(f"[SUCESSO] Atualizada Entrega {d_id} com {len(urls)} fotos!")
        updated_count += 1
        
    conn.close()
    print(f"\nRecuperação concluída! Total de entregas atualizadas com fotos: {updated_count}")

if __name__ == "__main__":
    recover_photos()
