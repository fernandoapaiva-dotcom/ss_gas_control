from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime

Base = declarative_base()

class Usuario(Base):
    __tablename__ = "usuarios"
    
    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False)
    usuario = Column(String, unique=True, index=True, nullable=False) # Updated field name to 'usuario'
    senha_hash = Column(String, nullable=False)
    nivel_acesso = Column(String, nullable=False) # 'adm', 'usuario'

class Cliente(Base):
    __tablename__ = "clientes"
    
    cnpj = Column(String(14), primary_key=True, index=True)
    nome_razao = Column(String, nullable=False)

class Entrega(Base):
    __tablename__ = "entregas"
    
    id = Column(Integer, primary_key=True, index=True)
    numero_documento = Column(String, nullable=False)
    data_aplicacao = Column(DateTime, default=datetime.utcnow)
    data_entrega = Column(DateTime, default=datetime.utcnow) # Added actual delivery date
    tipo_entrega = Column(String, nullable=False) # 'motorista', 'retirada'
    fk_cliente = Column(String(14), ForeignKey("clientes.cnpj"))
    fk_motorista = Column(Integer, ForeignKey("usuarios.id"))

class CilindroAplicado(Base):
    __tablename__ = "cilindros_aplicados"
    
    id = Column(Integer, primary_key=True, index=True)
    fk_entrega = Column(Integer, ForeignKey("entregas.id"))
    tipo_gas = Column(String, nullable=False) # ACETILENO, ARGONIO, CO2, MISTURA, NITROGENIO, OXIGENIO
    tamanho_gas = Column(String, nullable=False) # 1M3, 6M3, 7M3, 10M3, 1KG, 7KG, 25KG
    quantidade = Column(Integer, nullable=False)
    data_validade = Column(String, nullable=False) # Format MM/AA as requested
    url_foto = Column(String, nullable=True)
