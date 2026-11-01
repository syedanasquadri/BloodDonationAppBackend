import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }

  return secret;
};

export const authenticateUser = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Access token is required.",
      });
    }

    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, getJwtSecret());

    if (
      typeof decoded === "string" ||
      typeof decoded.sub !== "number" ||
      decoded.purpose === "signup"
    ) {
      return res.status(401).json({
        message: "Invalid access token.",
      });
    }

    res.locals.userId = decoded.sub;

    next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired access token.",
    });
  }
};