from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import data, routes

settings = get_settings()
app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Local-first ColdRoute SG prototype. No AWS integration and no API keys required for configured public endpoints.",
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


@app.get("/")
def root():
    return {"name": settings.app_name, "docs": "/docs", "status": "ok"}


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "aws_connected": False,
        "mode": "local",
        "public_api_policy": "No credentials are configured. Optional data.gov.sg API keys are intentionally not used.",
    }
