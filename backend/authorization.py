"""Authoritative role checks for broker-only API operations."""
import os
from urllib.parse import quote

import httpx
from fastapi import HTTPException, Request


async def read_account(user_id: str, authorization: str) -> dict:
    project = os.getenv("FIREBASE_PROJECT_ID", "libot-790e6")
    url = f"https://firestore.googleapis.com/v1/projects/{quote(project, safe='')}/databases/(default)/documents/users/{quote(user_id, safe='')}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(url, headers={"Authorization": authorization}, params=[("mask.fieldPaths", "role"), ("mask.fieldPaths", "accountStatus")])
        if response.status_code in {403, 404}:
            raise HTTPException(403, "An active broker account is required.")
        response.raise_for_status()
        fields = response.json().get("fields", {})
        return {key: fields.get(key, {}).get("stringValue") for key in ("role", "accountStatus")}
    except (httpx.HTTPError, ValueError, TypeError, AttributeError) as error:
        raise HTTPException(503, "Account authorization is temporarily unavailable.") from error


async def require_broker_access(request: Request):
    # The API security middleware verifies this token before dependencies run.
    claims = getattr(request.state, "firebase_user", None)
    if not claims:
        raise HTTPException(401, "Sign in to continue.")
    account = await read_account(str(claims["sub"]), request.headers.get("authorization", ""))
    if account.get("role") not in {"broker", "admin"} or account.get("accountStatus") == "inactive":
        raise HTTPException(403, "An active broker account is required.")
