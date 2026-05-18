"""
Migração: adiciona coluna nome_cliente na tabela entregas
e faz backfill dos registros existentes buscando na tabela clientes.

Execute UMA VEZ no servidor:
    python migrate_nome_cliente.py
"""
import sqlite3
import os

DB_PATH = os.environ.get("DB_PATH", "test.db")

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

# 1. Adiciona a coluna se ainda não existir
try:
    cur.execute("ALTER TABLE entregas ADD COLUMN nome_cliente TEXT")
    print("[OK] Coluna nome_cliente adicionada.")
except Exception as e:
    print(f"[INFO] Coluna já existe ou erro: {e}")

# 2. Backfill: preenche os registros antigos com o nome do cliente via FK
cur.execute("""
    UPDATE entregas
    SET nome_cliente = (
        SELECT nome_razao FROM clientes WHERE clientes.cnpj = entregas.fk_cliente
    )
    WHERE nome_cliente IS NULL AND fk_cliente IS NOT NULL
""")
updated = cur.rowcount
print(f"[OK] {updated} registros atualizados com o nome do cliente.")

conn.commit()
conn.close()
print("[CONCLUÍDO] Migração finalizada com sucesso.")
