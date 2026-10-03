import express from "express";
import cors from "cors";

import donorRoutes from "./routes/donor.routes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello, World!");
});

app.get("/api/health", (req, res) => {
  res.json({ message: "BloodConnect API is running" });
});

app.use("/api/donors", donorRoutes);

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});