import "dotenv/config";
import express from "express";
import cors from "cors";
import { matchesRouter } from "./routes/matches.js";

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL ?? "*" }));
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/matches", matchesRouter);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
