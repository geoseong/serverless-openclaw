import type { Request, Response, NextFunction } from "express";

export function createAuthMiddleware(
  authToken: string,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === "/health") {
      next();
      return;
    }

    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const token = header.slice(7);
    if (!token || token !== authToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  };
}
