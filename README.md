# SS Gas Control (PT/EN)

[Português](#português) | [English](#english)

---

## Português

Sistema completo para controle de entrega de cilindros de gás da Servweld, com foco em mobilidade, rastreabilidade e integração na nuvem.

### Funcionalidades Desenvolvidas
- **Registro de Entregas em Tempo Real:** Interface desenvolvida para os motoristas registrarem entregas diretamente do celular, adicionando as informações do cliente e o tipo de serviço.
- **Upload de Imagens para o Google Drive:** As fotos (comprovantes e cilindros) tiradas no momento da entrega são enviadas em tempo real e armazenadas diretamente no Google Drive, economizando espaço nos servidores locais e mantendo os arquivos organizados e seguros.
- **Visualização e Filtro de Imagens:** Ao acessar o painel administrativo ou pesquisar pelo histórico de entregas de um cliente, as imagens salvas no Drive são recuperadas e carregadas na interface para fácil conferência.
- **Captura de Geolocalização:** No exato momento do registro da foto de entrega, o sistema captura as coordenadas GPS (geolocalização) do dispositivo. Essa lógica foi implementada para que, no futuro, quando houver uma nova entrega para o mesmo cliente, o motorista saiba exatamente onde ele fica, tendo a opção de abrir a rota diretamente via **Google Maps** ou **Waze**.
- **Controle de Acesso (RBAC):** Níveis de permissão separados para motoristas (registro) e administradores (gestão, visualização de histórico e exclusão).

### Requisitos e Tecnologias
- Python 3.8+
- SQLite / PostgreSQL
- Integração Google Drive API (Conta de Serviço)
- Docker & Docker Compose para OCI (Oracle Cloud)

### Como Executar
1. Instale as dependências: `pip install -r requirements.txt`
2. Adicione as credenciais da conta de serviço Google (`service-account.json`) na raiz do projeto.
3. Configure o arquivo `.env`.
4. Inicie o servidor: `python main.py`

---

## English

A complete system for managing gas cylinder deliveries for Servweld, focusing on mobility, traceability, and cloud integration.

### Developed Features
- **Real-Time Delivery Registration:** A mobile-first interface designed for drivers to register deliveries straight from their devices, capturing customer info and service types.
- **Google Drive Real-Time Upload:** Photos (receipts, cylinder conditions) taken during the delivery are uploaded in real-time and stored directly on Google Drive. This saves local server space and keeps files organized securely.
- **Dynamic Image Loading on Filters:** When accessing the admin dashboard or filtering a customer's delivery history, the images saved on Google Drive are fetched and loaded into the UI for easy auditing.
- **Geolocation Capture:** At the exact moment a delivery photo is taken, the system captures the device's GPS coordinates. This logic was implemented so that in future deliveries to the same client, the driver will know the exact location, with the ability to launch the route directly via **Google Maps** or **Waze**.
- **Role-Based Access Control (RBAC):** Distinct permission levels for drivers (data entry) and administrators (management, history viewing, and deletion).

### Requirements and Tech Stack
- Python 3.8+
- SQLite / PostgreSQL
- Google Drive API Integration (Service Account)
- Docker & Docker Compose for OCI (Oracle Cloud)

### How to Run
1. Install dependencies: `pip install -r requirements.txt`
2. Place your Google Service Account credentials (`service-account.json`) in the project root.
3. Configure your `.env` file.
4. Start the server: `python main.py`
