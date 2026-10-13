from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException, Request, status


def get_cognito_claims(request: Request) -> dict[str, Any]:
    """Return JWT claims injected by an API Gateway HTTP API JWT authorizer."""
    event = request.scope.get("aws.event", {}) or {}
    request_context = event.get("requestContext", {}) or {}
    authorizer = request_context.get("authorizer", {}) or {}
    jwt = authorizer.get("jwt", {}) or {}
    claims = jwt.get("claims", {}) or {}

    if not isinstance(claims, dict):
        return {}
    return claims


def _normalise_cognito_groups(value: Any) -> list[str]:
    """Normalise the Cognito groups claim into a clean list of group names.

    API Gateway commonly exposes JWT claims as strings, while local tests or
    other integrations may preserve a JSON/list representation. Supporting
    both forms keeps role checking reliable across environments.
    """
    if value is None:
        return []

    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]

    text = str(value).strip()
    if not text:
        return []

    # Handles JSON-style values such as ["admin", "driver"].
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
    except (json.JSONDecodeError, TypeError):
        pass

    # Handles API Gateway/string representations such as "[admin]",
    # "admin,driver", or simply "admin".
    text = text.strip("[]")
    groups = []
    for item in text.split(","):
        group = item.strip().strip('"').strip("'")
        if group:
            groups.append(group)
    return groups


def get_current_user(request: Request) -> dict[str, Any]:
    """Return the authenticated Cognito user's identity and group membership.

    The Cognito ``sub`` claim is used as the stable database owner key. Email
    and username are display metadata. Groups are used for role-based access.
    """
    claims = get_cognito_claims(request)
    user_id = claims.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authenticated Cognito user could not be determined.",
        )

    return {
        "user_id": str(user_id),
        "email": str(claims.get("email") or ""),
        "username": str(claims.get("username") or claims.get("cognito:username") or ""),
        "groups": _normalise_cognito_groups(claims.get("cognito:groups")),
    }


def require_admin(request: Request) -> dict[str, Any]:
    """Require the authenticated Cognito user to belong to the ``admin`` group."""
    current_user = get_current_user(request)
    groups = current_user.get("groups", [])

    if "admin" not in groups:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )

    return current_user
