from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException

from backend.config import SUPABASE_DB_ENABLED, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL


async def get_current_user(authorization: str | None) -> dict[str, Any]:
    if not SUPABASE_DB_ENABLED:
        raise HTTPException(status_code=503, detail="Supabase auth is not configured")
    token = (authorization or "").strip()
    if not token.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    access_token = token.split(" ", 1)[1].strip()
    if not access_token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
        response = await client.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {access_token}",
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
            },
        )
    if response.status_code >= 400:
        detail = response.text or response.reason_phrase
        raise HTTPException(status_code=401, detail=detail)
    user = response.json()
    if not isinstance(user, dict) or not user.get("id"):
        raise HTTPException(status_code=401, detail="Invalid auth user response")
    return user
