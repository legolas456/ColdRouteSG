from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import admin, data, routes, traffic

settings = get_settings()
app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description=(
        "ColdRoute SG API: public data, live road speeds (/api/traffic/grid, needs an LTA "
        "DataMall AccountKey), and Cognito-protected route history in DynamoDB."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(data.router)
app.include_router(routes.router)
app.include_router(traffic.router)
app.include_router(admin.router)


@app.get("/")
def root():
    return {"name": settings.app_name, "docs": "/docs", "status": "ok"}


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "aws_connected": bool(settings.dynamodb_routes_table),
        "mode": "aws" if settings.dynamodb_routes_table else "local",
        "dynamodb_route_history": bool(settings.dynamodb_routes_table),
        "public_api_policy": "External routing and public-data integrations are retrieved by the backend.",
    }
