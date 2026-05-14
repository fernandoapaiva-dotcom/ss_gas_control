from fastapi import Request, HTTPException, Security, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from models import Usuario
from typing import List, Callable
import functools

security = HTTPBearer()

# Permissive function to allow testing without login
# In production, this would verify a JWT token
async def get_current_user(request: Request):
    # Returns a default admin for dev/testing
    return {"id": 1, "nome": "Admin Test", "usuario": "admin", "nivel_acesso": "adm"}

def role_required(allowed_roles: List[str]):
    def decorator(func: Callable):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # Check if 'current_user' is in kwargs (provided by Depends)
            user = kwargs.get('current_user')
            if not user or user['nivel_acesso'] not in allowed_roles:
                raise HTTPException(status_code=403, detail="Acesso negado")
            return await func(*args, **kwargs)
        return wrapper
    return decorator
