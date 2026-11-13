from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .database import get_db
from .db_models import AuditEvent, RefreshToken, User
from .security import hash_password, verify_password

ROLES = {"admin", "business_owner", "accountant", "collections"}
SECRET = os.getenv("JWT_SECRET_KEY", "local-development-only-change-this-secret")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
REFRESH_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "14"))
if os.getenv("APP_ENV", "development").lower() == "production" and (
    len(SECRET) < 32
    or SECRET in {"local-development-only-change-this-secret", "replace_with_a_random_secret"}
):
    raise RuntimeError("JWT_SECRET_KEY must be a unique secret of at least 32 characters in production")
bearer = HTTPBearer(auto_error=False)

def _token(user: User, kind: str, jti: str | None = None, expires: int | None = None) -> str:
    now = datetime.now(timezone.utc)
    claims = {"sub": str(user.id), "role": user.role, "type": kind, "iat": now, "exp": now + timedelta(seconds=expires or ACCESS_MINUTES*60)}
    if jti: claims["jti"] = jti
    return jwt.encode(claims, SECRET, algorithm=ALGORITHM)

def issue_pair(user: User, db: Session) -> dict:
    jti = str(uuid4()); expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_DAYS)
    db.add(RefreshToken(jti=jti, user_id=user.id, expires_at=expire))
    return {"accessToken": _token(user,"access"), "refreshToken": _token(user,"refresh",jti,REFRESH_DAYS*86400), "tokenType":"bearer", "expiresIn":ACCESS_MINUTES*60, "user":{"id":str(user.id),"name":user.name,"email":user.email,"role":user.role,"company":"FlowCred Workspace"}}

def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User:
    if not credentials: raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required", headers={"WWW-Authenticate":"Bearer"})
    try:
        claims = jwt.decode(credentials.credentials, SECRET, algorithms=[ALGORITHM])
        if claims.get("type") != "access": raise ValueError("wrong token type")
        user_id = int(claims["sub"])
    except Exception as exc: raise HTTPException(401, "Invalid or expired access token") from exc
    user = db.get(User, user_id)
    if not user or not user.is_active: raise HTTPException(401, "Account is unavailable")
    return user

def allow_roles(*roles: str):
    def check(user: User = Depends(current_user)) -> User:
        if user.role not in roles: raise HTTPException(403, "Your role cannot access this resource")
        return user
    return check

def audit(db: Session, user: User | None, action: str, entity_type: str | None = None, entity_id: str | None = None, details: dict | None = None):
    db.add(AuditEvent(user_id=user.id if user else None, action=action, entity_type=entity_type, entity_id=entity_id, details=details))
