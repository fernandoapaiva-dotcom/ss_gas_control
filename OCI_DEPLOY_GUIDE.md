# Guia de Deploy OCI - SS Gas Control

Este guia descreve como implantar o sistema SS Gas Control em uma instância da Oracle Cloud Infrastructure (OCI).

## 1. Preparação da Instância

### Instalar Docker e Docker Compose
Se estiver usando **Ubuntu** ou **Oracle Linux**, execute:

```bash
# Atualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Docker
sudo apt install docker.io -y
sudo systemctl enable --now docker

# Instalar Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Adicionar seu usuário ao grupo docker
sudo usermod -aG docker $USER
# (Faça logout e login novamente para aplicar)
```

## 2. Configuração dos Arquivos

1.  Crie uma pasta para o projeto: `mkdir ss_gas_control && cd ss_gas_control`.
2.  Envie os arquivos do projeto para esta pasta (via SCP, Git ou SFTP).
3.  **Importante**: Garanta que os seguintes arquivos estejam presentes:
    *   `Dockerfile`
    *   `docker-compose.yml`
    *   `requirements.txt`
    *   `main.py`, `storage.py`, `models.py`, `auth.py`, `reports.py`
    *   `.env` (Baseado no `.env.example`)
    *   `service-account.json` (Suas credenciais do Google Cloud)

### Configurar o .env
Edite o arquivo `.env` e preencha com suas chaves reais:
```bash
nano .env
```

## 3. Abertura de Portas (Firewall)

O sistema usa a porta **8002**. Você precisa liberá-la em dois níveis:

### Nível 1: Painel OCI (VCN Security List)
1.  Vá em **Networking > Virtual Cloud Networks > [Sua VCN] > Security Lists**.
2.  Adicione uma **Ingress Rule**:
    *   **Source CIDR**: `0.0.0.0/0`
    *   **IP Protocol**: `TCP`
    *   **Destination Port Range**: `8002`

### Nível 2: Sistema Operacional (Ubuntu/Oracle Linux)
No terminal da instância, execute:

```bash
# Se usar Ubuntu (iptables padrão da OCI)
sudo iptables -I INPUT 6 -p tcp --dport 8002 -j ACCEPT
sudo netfilter-persistent save

# Se usar Oracle Linux (firewalld)
sudo firewall-cmd --permanent --add-port=8002/tcp
sudo firewall-cmd --reload
```

## 4. Execução do Sistema

Para iniciar o sistema em segundo plano:

```bash
docker-compose up -d --build
```

### Comandos Úteis
*   **Ver logs**: `docker-compose logs -f backend_gas`
*   **Parar sistema**: `docker-compose down`
*   **Reiniciar**: `docker-compose restart`

---
> [!TIP]
> Se você já tem a pasta `ss-gas-control-b906e5e2d141`, pode renomeá-la para facilitar:
> `mv ss-gas-control-b906e5e2d141 ss_gas_control`
