from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "ColdRoute SG API"
    allow_mock_fallback: bool = True
    request_timeout_seconds: float = 12.0
    cors_origins: str = "http://localhost:5173"
    # LTA DataMall AccountKey for live road speeds (free sign-up). Never commit it.
    lta_account_key: str = ""
    # When set, /api/traffic/grid reads the grid the scheduled job publishes here
    # instead of calling LTA on request.
    traffic_bucket: str = ""
    traffic_key: str = "traffic/speed-grid.json"
    dynamodb_routes_table: str = ""
    aws_region: str = "ap-southeast-1"
    cognito_user_pool_id: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
