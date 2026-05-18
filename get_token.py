import os
from google_auth_oauthlib.flow import InstalledAppFlow

# Scopes required for the app
SCOPES = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive']

def get_refresh_token():
    # It will look for client_secrets.json in the current directory
    flow = InstalledAppFlow.from_client_secrets_file(
        'client_secrets.json', SCOPES)
    
    # We fix the port to 8080 to match Google Cloud Console settings
    creds = flow.run_local_server(port=8080, prompt='consent')
    
    print("\n" + "="*50)
    print("AUTENTICAÇÃO CONCLUÍDA COM SUCESSO!")
    print("="*50)
    print(f"\nSeu GOOGLE_REFRESH_TOKEN é:\n\n{creds.refresh_token}\n")
    print("="*50)
    print("Copie o código acima e cole no seu arquivo .env")
    print("="*50 + "\n")

if __name__ == '__main__':
    get_refresh_token()
