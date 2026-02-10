import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { createAuthMiddleware } from "../src/auth-middleware.js";

function mockReq(
  path: string,
  authHeader?: string,
): Partial<Request> {
  return {
    path,
    headers: authHeader ? { authorization: authHeader } : {},
  };
}

function mockRes(): Partial<Response> {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis() as unknown as Response["status"],
    json: vi.fn().mockReturnThis() as unknown as Response["json"],
  };
  return res;
}

describe("createAuthMiddleware", () => {
  const AUTH_TOKEN = "test-secret-token";
  const middleware = createAuthMiddleware(AUTH_TOKEN);

  it("should call next() for valid Bearer token", () => {
    const req = mockReq("/message", `Bearer ${AUTH_TOKEN}`);
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should return 401 for missing Authorization header", () => {
    const req = mockReq("/message");
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    middleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
  });

  it("should return 401 for invalid token", () => {
    const req = mockReq("/message", "Bearer wrong-token");
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    middleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("should skip auth for GET /health", () => {
    const req = mockReq("/health");
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should return 401 for Bearer prefix without token", () => {
    const req = mockReq("/message", "Bearer ");
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    middleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("should return 401 for non-Bearer auth scheme", () => {
    const req = mockReq("/message", `Basic ${AUTH_TOKEN}`);
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    middleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
