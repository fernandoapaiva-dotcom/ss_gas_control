# SS_Gas_Control Backend

Backend para o sistema de controle de entrega de cilindros de gás da Servweld.

## Requisitos
- Python 3.8+
- PostgreSQL
- Conta de Serviço do Google Cloud (com API do Drive ativada)

## Instalação
1. Clone o repositório.
2. Instale as dependências:
   ```bash
   pip install -r requirements.txt
   ```
3. Coloque o arquivo `service-account.json` na raiz do projeto ou defina a variável de ambiente `GOOGLE_APPLICATION_CREDENTIALS`.

## Como Executar
```bash
python main.py
```

## Estrutura do Projeto
- `models.py`: Modelos do banco de dados (SQLAlchemy/Antigravity).
- `storage.py`: Integração com o Google Drive para upload de fotos.
- `auth.py`: Controle de acesso baseado em funções (RBAC).
- `main.py`: Endpoints da API REST.

## Endpoints Principais
- `POST /api/entregas`: Registro de entrega (Multipart Form).
- `GET /api/clientes/{cnpj}/historico`: Histórico de entregas do cliente.
- `DELETE /api/entregas/{id}`: Exclusão de entrega (Apenas ADM).
