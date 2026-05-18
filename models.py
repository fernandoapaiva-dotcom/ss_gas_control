from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Float, Text
from sqlalchemy.orm import relationship
from database import Base
from datetime import datetime

class Usuario(Base):
    __tablename__ = "usuarios"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    full_name = Column(String)
    hashed_password = Column(String)
    role = Column(String, default="motorista")

class Cliente(Base):
    __tablename__ = "clientes"
    cnpj = Column(String(14), primary_key=True, index=True)
    nome_razao = Column(String, nullable=False)
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    
    # Relação com entregas
    entregas = relationship("Entrega", back_populates="cliente")

class Entrega(Base):
    __tablename__ = "entregas"
    id = Column(Integer, primary_key=True, index=True)
    numero_documento = Column(String, index=True)
    nome_cliente = Column(String, nullable=True)  # campo redundante para fallback
    data_aplicacao = Column(DateTime, default=datetime.utcnow)
    data_entrega = Column(DateTime)
    tipo_entrega = Column(String, nullable=False)
    fk_cliente = Column(String(14), ForeignKey("clientes.cnpj"), nullable=True)
    fk_motorista = Column(Integer, ForeignKey("usuarios.id"))
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    fotos_urls = Column(Text, nullable=True)
    
    # Relações
    cliente = relationship("Cliente", back_populates="entregas")
    cilindros = relationship("CilindroAplicado", back_populates="entrega", cascade="all, delete-orphan")

class CilindroAplicado(Base):
    __tablename__ = "cilindros_aplicados"
    id = Column(Integer, primary_key=True, index=True)
    fk_entrega = Column(Integer, ForeignKey("entregas.id"))
    tipo_gas = Column(String)
    tamanho_gas = Column(String)
    quantidade = Column(Integer, default=1)
    observacao = Column(Text, nullable=True)
    
    # Relação
    entrega = relationship("Entrega", back_populates="cilindros")
