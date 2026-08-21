import "dotenv/config";
import express from "express";
import cors from "cors";
import { matchesRouter } from "./routes/matches.js";

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL ?? "*" }));
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/matches", matchesRouter);

// Catches anything routes forward via asyncHandler/next(err), plus sync
// throws — keeps the API contract as JSON instead of Express's default HTML
// error page (which would also leak a stack trace).
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
