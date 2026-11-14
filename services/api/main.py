#!/usr/bin/env python3
"""Optional FastAPI gateway in front of the QA-DNR service.

The platform itself ships a versioned REST API implemented with Next.js route
handlers (no Python runtime required). This gateway exists for deployments that
standardise on FastAPI: it exposes the same resource names, adds OpenAPI docs and
forwards to the Node service, forwarding the session cookie so RBAC and audit
still apply.

Install: pip install fastapi uvicorn httpx
Run:     uvicorn services.api.main:app --port 8000
Docs:    http://localhost:8000/docs
"""
from __future__ import annotations

import os
from typing import Any, Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

UPSTREAM = os.environ.get("QA_DNR_UPSTREAM", "http://127.0.0.1:3000")
SESSION_COOKIE = "qa_dnr_session"

app = FastAPI(
    title="QA-DNR Gateway",
    version="1.0.0",
    description=(
        "Thin FastAPI facade over the QA-DNR optimisation service. "
        "Recommendations are advisory and pass AC power-flow validation upstream."
    ),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("QA_DNR_CORS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunParams(BaseModel):
    topK: int = Field(12, ge=1, le=60)
    iterations: int = Field(6000, ge=200, le=120000)
    restarts: int = Field(3, ge=1, le=10)
    penaltyWeight: Optional[float] = None
    refinementIterations: int = Field(6, ge=0, le=20)
    derPenetrationPct: float = Field(0, ge=0, le=200)
    voltageMin: float = 0.9
    voltageMax: float = 1.05
    maxLoadingPct: float = 100
    baselineBranchExchange: bool = True
    baselineBruteForce: bool = False
    baselineMilp: bool = False
    maxSwitchingOps: Optional[int] = None
    scenarioId: Optional[int] = None
    timeoutMs: int = Field(25000, ge=2000, le=120000)


class RunRequest(BaseModel):
    networkId: int = Field(..., ge=1)
    solver: str = Field("simulated-annealing")
    seed: int = 42
    params: RunParams = RunParams()


class LoginRequest(BaseModel):
    username: str
    password: str


class FaultSpec(BaseModel):
    branch: int
    kind: str = "line"


class FaultRequest(BaseModel):
    networkId: int
    label: Optional[str] = None
    faults: list[FaultSpec] = []
    criticalBuses: list[str] = []


async def upstream_client(request: Request) -> httpx.AsyncClient:
    headers: dict[str, str] = {}
    cookie = request.cookies.get(SESSION_COOKIE)
    if cookie:
        headers["cookie"] = f"{SESSION_COOKIE}={cookie}"
    return httpx.AsyncClient(base_url=UPSTREAM, headers=headers, timeout=120.0)


async def require_session(request: Request) -> str:
    if not request.cookies.get(SESSION_COOKIE) and os.environ.get("QA_DNR_REQUIRE_AUTH", "true") == "true":
        raise HTTPException(status_code=401, detail="Authentication required")
    return request.cookies.get(SESSION_COOKIE, "demo")


@app.get("/health", tags=["platform"])
async def health() -> dict[str, Any]:
    async with httpx.AsyncClient(base_url=UPSTREAM, timeout=20.0) as client:
        response = await client.get("/api/health")
        return response.json()


@app.get("/version", tags=["platform"])
async def version() -> dict[str, Any]:
    async with httpx.AsyncClient(base_url=UPSTREAM, timeout=20.0) as client:
        return (await client.get("/api/version")).json()


@app.post("/auth/login", tags=["auth"])
async def login(payload: LoginRequest, response: Response) -> dict[str, Any]:
    async with httpx.AsyncClient(base_url=UPSTREAM, timeout=20.0) as client:
        upstream = await client.post("/api/auth/login", json=payload.model_dump())
    if upstream.status_code != 200:
        raise HTTPException(status_code=upstream.status_code, detail=upstream.json())
    cookie = upstream.headers.get("set-cookie", "")
    if cookie:
        response.headers.append("set-cookie", cookie)
    return upstream.json()


@app.get("/networks", tags=["networks"])
async def networks() -> dict[str, Any]:
    async with httpx.AsyncClient(base_url=UPSTREAM, timeout=30.0) as client:
        return (await client.get("/api/networks")).json()


@app.get("/networks/{network_id}", tags=["networks"])
async def network(network_id: int) -> dict[str, Any]:
    async with httpx.AsyncClient(base_url=UPSTREAM, timeout=30.0) as client:
        response = await client.get(f"/api/networks/{network_id}")
        if response.status_code == 404:
            raise HTTPException(status_code=404, detail="Network not found")
        return response.json()


@app.post("/runs", status_code=202, tags=["optimisation"], dependencies=[Depends(require_session)])
async def create_run(payload: RunRequest, request: Request) -> dict[str, Any]:
    async with await upstream_client(request) as client:
        response = await client.post("/api/runs", json=payload.model_dump())
        if response.status_code >= 400:
            raise HTTPException(status_code=response.status_code, detail=response.json())
        return response.json()


@app.get("/runs", tags=["optimisation"])
async def list_runs(limit: int = 40) -> dict[str, Any]:
    async with httpx.AsyncClient(base_url=UPSTREAM, timeout=30.0) as client:
        return (await client.get("/api/runs", params={"limit": limit})).json()


@app.get("/runs/{run_id}", tags=["optimisation"])
async def run(run_id: int) -> dict[str, Any]:
    async with httpx.AsyncClient(base_url=UPSTREAM, timeout=30.0) as client:
        response = await client.get(f"/api/runs/{run_id}")
        if response.status_code == 404:
            raise HTTPException(status_code=404, detail="Run not found")
        return response.json()


@app.post("/faults", status_code=201, tags=["resilience"], dependencies=[Depends(require_session)])
async def faults(payload: FaultRequest, request: Request) -> dict[str, Any]:
    async with await upstream_client(request) as client:
        response = await client.post("/api/faults", json=payload.model_dump())
        if response.status_code >= 400:
            raise HTTPException(status_code=response.status_code, detail=response.json())
        return response.json()


@app.get("/metrics", tags=["platform"], dependencies=[Depends(require_session)])
async def metrics(request: Request) -> dict[str, Any]:
    async with await upstream_client(request) as client:
        response = await client.get("/api/metrics")
        if response.status_code >= 400:
            raise HTTPException(status_code=response.status_code, detail=response.json())
        return response.json()
