from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def _cognito_client():
    kwargs: dict[str, Any] = {}
    if settings.aws_region:
        kwargs["region_name"] = settings.aws_region
    return boto3.client("cognito-idp", **kwargs)


@lru_cache(maxsize=512)
def resolve_email_for_sub(user_sub: str) -> str:
    """Resolve a Cognito user's email from the stable ``sub`` stored in DynamoDB.

    Route history is keyed by Cognito ``sub``. Older route records may not have
    ``user_email`` populated, so the admin dashboard can use Cognito as the
    authoritative identity source without rewriting historical DynamoDB items.
    """
    user_sub = (user_sub or "").strip()
    user_pool_id = settings.cognito_user_pool_id.strip()

    if not user_sub or not user_pool_id:
        return ""

    try:
        response = _cognito_client().list_users(
            UserPoolId=user_pool_id,
            Filter=f'sub = "{user_sub}"',
            Limit=1,
        )
    except (BotoCoreError, ClientError) as exc:
        logger.warning("Unable to resolve Cognito email for sub %s: %s", user_sub, exc)
        return ""

    users = response.get("Users") or []
    if not users:
        return ""

    attributes = users[0].get("Attributes") or []
    for attribute in attributes:
        if attribute.get("Name") == "email":
            return str(attribute.get("Value") or "").strip()

    return ""
