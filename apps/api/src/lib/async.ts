import type { NextFunction, Request, Response } from "express";

// Small promise-catch wrapper so async route handlers can't hang on a
// rejected promise (Express 4 doesn't catch these). The centralized
// errorMiddleware (hardening box, spec §13.2) sits downstream of this.
export function catchAsync(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
