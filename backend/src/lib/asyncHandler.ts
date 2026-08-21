import type { NextFunction, Request, RequestHandler, Response } from "express";

// Express 4 doesn't catch rejected promises from async route handlers on its
// own — an unhandled rejection there just hangs the request. Wrapping routes
// with this forwards any thrown/rejected error to the error-handling
// middleware in index.ts instead.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
