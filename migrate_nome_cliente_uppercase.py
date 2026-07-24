from main import SessionLocal
from models import Cliente, Entrega

def run_migration():
    db = SessionLocal()
    try:
        print("Iniciando conversão de nomes para CAIXA ALTA...")
        clientes = db.query(Cliente).all()
        c_count = 0
        for c in clientes:
            if c.nome_razao:
                c.nome_razao = c.nome_razao.upper()
                c_count += 1
        
        entregas = db.query(Entrega).all()
        e_count = 0
        for e in entregas:
            if e.nome_cliente:
                e.nome_cliente = e.nome_cliente.upper()
                e_count += 1

        db.commit()
        print(f"Sucesso! {c_count} clientes e {e_count} entregas convertidos para CAIXA ALTA.")
    except Exception as err:
        print("Erro na migração:", err)
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    run_migration()
