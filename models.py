from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Float, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime

Base = declarative_base()

class Usuario(Base):
    __tablename__ = "usuarios"
    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False)
    usuario = Column(String, unique=True, index=True, nullable=False)
    senha_hash = Column(String, nullable=False)
    nivel_acesso = Column(String, nullable=False)  # 'adm', 'usuario'

class Cliente(Base):
    __tablename__ = "clientes"
    cnpj = Column(String(14), primary_key=True, index=True)
    nome_razao = Column(String, nullable=False)
    lat = Column(String, nullable=True)
    lng = Column(String, nullable=True)
    entregas = relationship("Entrega", back_populates="cliente")

class Entrega(Base):
    __tablename__ = "entregas"
    id = Column(Integer, primary_key=True, index=True)
    numero_documento = Column(String, nullable=False)
    nome_cliente = Column(String, nullable=True)
    data_aplicacao = Column(DateTime, default=datetime.utcnow)
    data_entrega = Column(DateTime, default=datetime.utcnow)
    tipo_entrega = Column(String, nullable=False)
    fk_cliente = Column(String(14), ForeignKey("clientes.cnpj"), nullable=True)
    fk_motorista = Column(Integer, ForeignKey("usuarios.id"))
    lat = Column(String, nullable=True)
    lng = Column(String, nullable=True)
    fotos_urls = Column(Text, nullable=True)
    cliente = relationship("Cliente", back_populates="entregas")
    cilindros = relationship("CilindroAplicado", back_populates="entrega", cascade="all, delete-orphan")

class CilindroAplicado(Base):
    __tablename__ = "cilindros_aplicados"
    id = Column(Integer, primary_key=True, index=True)
    fk_entrega = Column(Integer, ForeignKey("entregas.id"))
    tipo_gas = Column(String, nullable=False)
    tamanho_gas = Column(String, nullable=False)
    quantidade = Column(Integer, nullable=False)
    data_validade = Column(String, nullable=True)
    url_foto = Column(String, nullable=True)
    observacao = Column(String, nullable=True)
    entrega = relationship("Entrega", back_populates="cilindros")
